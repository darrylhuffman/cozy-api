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
 *   { "uses": "./nodes/users/save-user", "inputs": {...}, "outputs": {...} }
 *
 * Errors are written to stderr but do NOT crash the worker — best-effort.
 */
import { readdir, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { extname, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

interface ZodLike {
  toJSONSchema(schema: unknown): unknown
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

      const inputs = toJsonSchemaSafe(z, inputsSchema)
      const outputs = toJsonSchemaSafe(z, outputsSchema)

      process.stdout.write(`${JSON.stringify({ uses: usesKey, inputs, outputs })}\n`)
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
