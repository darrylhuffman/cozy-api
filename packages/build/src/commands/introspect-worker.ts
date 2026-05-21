/**
 * Introspect worker — runs as a tsx subprocess from the user's workspace.
 *
 * Walks <workspaceRoot>/nodes/** for .ts files, dynamic-imports each, reads its
 * default export's `inputs` / `outputs` Zod schemas, converts them to JSON
 * Schema via z.toJSONSchema (loaded from the workspace's own zod install so
 * the schema's internal symbols match), prints one NDJSON line per file to
 * stdout.
 *
 * Stdout shape (one JSON object per line):
 *   { "uses": "./nodes/users/save-user", "inputs": {...}, "outputs": {...}, "description": "..." }
 *
 * Errors are written to stderr but do NOT crash the worker — best-effort.
 */
import { readFileSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { extname, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import * as ts from "typescript"

interface ZodLike {
  toJSONSchema(schema: unknown): unknown
}

/**
 * Extracts the leading TSDoc/JSDoc comment for a node file using the TypeScript
 * Compiler API (so comments aren't stripped at runtime).
 *
 * Strategy (in order):
 *  1. Leading JSDoc directly above `export default defineNode(...)` or
 *     `export default <expr>`.
 *  2. If the export default references a variable name, the leading JSDoc
 *     above that variable declaration.
 *  3. The first JSDoc found on any property inside the `defineNode({...})`
 *     object literal argument (catches the common pattern where the doc sits
 *     on the `run` method).
 */
export function extractTSDoc(absPath: string): string | null {
  let source: string
  try {
    source = readFileSync(absPath, "utf-8")
  } catch {
    return null
  }
  const sf = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true)

  let comment: string | null = null

  for (const stmt of sf.statements) {
    if (!ts.isExportAssignment(stmt) || stmt.isExportEquals) continue

    // Strategy 1: JSDoc directly above the `export default` statement
    const ranges = ts.getLeadingCommentRanges(source, stmt.pos)
    if (ranges && ranges.length > 0) {
      const last = ranges[ranges.length - 1]!
      if (source.substring(last.pos, last.pos + 3) === "/**") {
        comment = parseJsDocText(source.substring(last.pos, last.end))
      }
    }

    if (!comment && ts.isIdentifier(stmt.expression)) {
      // Strategy 2: export default is a bare identifier — look up its declaration
      const name = stmt.expression.text
      for (const inner of sf.statements) {
        if (!ts.isVariableStatement(inner)) continue
        const decl = inner.declarationList.declarations.find(
          (d) => ts.isIdentifier(d.name) && d.name.text === name,
        )
        if (!decl) continue
        const innerRanges = ts.getLeadingCommentRanges(source, inner.pos)
        if (innerRanges && innerRanges.length > 0) {
          const last = innerRanges[innerRanges.length - 1]!
          if (source.substring(last.pos, last.pos + 3) === "/**") {
            comment = parseJsDocText(source.substring(last.pos, last.end))
          }
        }
        break
      }
    }

    if (!comment) {
      // Strategy 3: scan inside `defineNode({...})` for the first property JSDoc
      comment = extractJsDocFromDefineNodeArg(source, stmt.expression)
    }

    break
  }

  return comment
}

/**
 * Walks the expression looking for a `defineNode(<object>)` call and extracts
 * the first JSDoc comment found on any property of the object literal.
 */
function extractJsDocFromDefineNodeArg(source: string, expr: ts.Expression): string | null {
  // Could be `defineNode({...})` or wrapped in an await/as-expression etc.
  // Unwrap call expression.
  const call = findCallExpression(expr)
  if (!call || call.arguments.length === 0) return null
  const firstArg = call.arguments[0]!
  if (!ts.isObjectLiteralExpression(firstArg)) return null

  for (const prop of firstArg.properties) {
    const ranges = ts.getLeadingCommentRanges(source, prop.pos)
    if (!ranges || ranges.length === 0) continue
    const last = ranges[ranges.length - 1]!
    if (source.substring(last.pos, last.pos + 3) === "/**") {
      return parseJsDocText(source.substring(last.pos, last.end))
    }
  }
  return null
}

function findCallExpression(expr: ts.Expression): ts.CallExpression | null {
  if (ts.isCallExpression(expr)) return expr
  if (ts.isAsExpression(expr)) return findCallExpression(expr.expression)
  if (ts.isAwaitExpression(expr)) return findCallExpression(expr.expression)
  return null
}

export function parseJsDocText(raw: string): string {
  // Strip /** ... */ delimiters and per-line ` * ` prefixes, keep content
  const inner = raw.replace(/^\/\*\*\s*/, "").replace(/\s*\*\/$/, "")
  return inner
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim()
}

async function main(): Promise<void> {
  const workspaceRoot = resolve(process.argv[2] ?? process.cwd())
  const nodesDir = join(workspaceRoot, "nodes")

  if (!(await dirExists(nodesDir))) {
    return
  }

  // Load zod from the workspace's own node_modules. This is critical: if we
  // imported a different zod here than the one a user's node file imported, the
  // internal symbol checks inside z.toJSONSchema would fail.
  const z = await loadWorkspaceZod(workspaceRoot)

  for await (const abs of walk(nodesDir, ".ts")) {
    if (abs.endsWith(".test.ts") || abs.endsWith(".test-d.ts")) continue

    try {
      const mod = (await import(pathToFileURL(abs).href)) as { default?: unknown }
      const def = mod.default
      if (!def || typeof def !== "object") continue

      const usesKey = `./${relative(workspaceRoot, abs).replaceAll("\\", "/").replace(/\.ts$/, "")}`

      const inputsSchema = (def as { inputs?: unknown }).inputs
      const outputsSchema = (def as { outputs?: unknown }).outputs
      const rawColor = (def as { color?: unknown }).color
      const color = typeof rawColor === "string" ? rawColor : null

      const inputs = toJsonSchemaSafe(z, inputsSchema)
      const outputs = toJsonSchemaSafe(z, outputsSchema)

      const description = extractTSDoc(abs)

      process.stdout.write(`${JSON.stringify({ uses: usesKey, inputs, outputs, color, description })}\n`)
    } catch (e) {
      process.stderr.write(`introspect-worker: failed for ${abs}: ${(e as Error).message}\n`)
    }
  }
}

async function loadWorkspaceZod(workspaceRoot: string): Promise<ZodLike | null> {
  try {
    // Resolve zod from the workspace root, then dynamic-import via file URL
    const require_ = createRequire(join(workspaceRoot, "package.json"))
    const zodEntry = require_.resolve("zod")
    const mod = (await import(pathToFileURL(zodEntry).href)) as { z?: ZodLike } & ZodLike
    // zod 4 exports both `z` and named members from the top-level entry
    return (mod.z ?? mod) as ZodLike
  } catch (e) {
    process.stderr.write(
      `introspect-worker: cannot load zod from workspace: ${(e as Error).message}\n`,
    )
    return null
  }
}

function toJsonSchemaSafe(z: ZodLike | null, schema: unknown): Record<string, unknown> {
  if (!z || !schema || typeof schema !== "object") {
    return { type: "object", properties: {} }
  }
  try {
    const result = z.toJSONSchema(schema) as Record<string, unknown>
    return result
  } catch {
    return { type: "object", properties: {} }
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    return s.isDirectory()
  } catch {
    return false
  }
}

async function* walk(dir: string, extension: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full, extension)
    } else if (extname(entry.name) === extension) {
      yield full
    }
  }
}

main().catch((e: Error) => {
  process.stderr.write(`introspect-worker: fatal: ${e.message}\n`)
  process.exit(1)
})
