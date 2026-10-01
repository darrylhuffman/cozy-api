import { readFile, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { loadWorkspace, planProviders, scanProviderFiles } from "@darrylondil/lorien-runtime"
import * as ts from "typescript"
import { introspectProviders, toPosix, walkTs } from "../commands/introspect-providers.js"

export type CheckSeverity = "error" | "warning"

export interface CheckFinding {
  /** Stable id, e.g. "node-reads-env". */
  rule: string
  severity: CheckSeverity
  /** Project-relative path. */
  file: string
  /** 1-based, when the finding points at a line. */
  line?: number
  /** What is wrong. */
  message: string
  /** Where the code should live instead: the part an agent acts on. */
  fix: string
}

export interface CheckResult {
  findings: CheckFinding[]
  errors: number
  warnings: number
}

/**
 * Database, cache and queue clients. A node importing one directly is opening
 * its own connection instead of reading a provider.
 */
const DRIVERS = new Set([
  "node:sqlite",
  "pg",
  "postgres",
  "mysql",
  "mysql2",
  "better-sqlite3",
  "sqlite3",
  "@libsql/client",
  "mongodb",
  "mongoose",
  "redis",
  "ioredis",
  "@upstash/redis",
  "@prisma/client",
  "drizzle-orm",
  "knex",
  "kysely",
  "@neondatabase/serverless",
  "@planetscale/database",
  "@supabase/supabase-js",
  "amqplib",
  "kafkajs",
])

/**
 * Checks that a lorien project keeps things where they belong: dependencies
 * in providers, business logic and nothing else in nodes, env vars declared by
 * the provider that needs them. Static (TypeScript's parser), so it never runs
 * project code. Each finding says where the code should live.
 */
export async function runCheck(root: string): Promise<CheckResult> {
  const findings: CheckFinding[] = []
  const scan = await scanProviderFiles(root)
  for (const e of scan.errors) {
    findings.push({
      rule: "provider-selector",
      severity: "error",
      file: e.path,
      message: e.message,
      fix: 'Give each provider a unique selector written as a string: selector: "db".',
    })
  }

  const introspection = await introspectProviders(root, {})
  const providers = introspection.providers
  const plan = planProviders(
    providers.map((p) => ({ name: p.name, lifetime: p.lifetime, uses: p.uses })),
  )
  for (const message of plan.errors) {
    const name = /provider "([^"]+)"/.exec(message)?.[1]
    findings.push({
      rule: "provider-lifetime",
      severity: "error",
      file: providers.find((p) => p.name === name)?.path ?? "providers/",
      message,
      fix: "A singleton lives for the whole app, so it may only use other singletons.",
    })
  }

  for (const p of providers) {
    const source = await readFile(join(root, p.path), "utf-8")
    for (const exp of exportedFunctions(source, p.path)) {
      findings.push({
        rule: "provider-exports-logic",
        severity: "warning",
        file: p.path,
        line: exp.line,
        message: `provider exports ${exp.name}(), but a provider only sets up a dependency`,
        fix: `Move ${exp.name} into a node in nodes/ if it is business logic, or into lib/ if it is a shared helper. Code private to this provider goes in ${p.path.replace(/\.[mc]?[jt]s$/, "/")}.`,
      })
    }
  }

  // A package a provider already wraps (pg in providers/db.ts) → that provider.
  const wrappedBy = new Map<string, string>()
  for (const p of providers) for (const pkg of p.packages) wrappedBy.set(pkg, p.name)

  for (const abs of await walkTs(join(root, "nodes"))) {
    const file = toPosix(relative(root, abs))
    const source = await readFile(abs, "utf-8")
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1

    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
      if (stmt.importClause?.isTypeOnly) continue
      const pkg = packageOf(stmt.moduleSpecifier.text)
      const provider = pkg ? wrappedBy.get(pkg) : undefined
      if (!pkg || !(provider || DRIVERS.has(pkg))) continue
      findings.push({
        rule: "node-imports-driver",
        severity: "warning",
        file,
        line: lineOf(stmt),
        message: `node imports ${pkg} directly`,
        fix: provider
          ? `Read the ${provider} provider from run()'s second argument instead: run(input, { ${provider} }).`
          : `Open the connection once in a provider (providers/<name>.ts with defineProvider) and read it from run()'s second argument.`,
      })
    }

    const seen = new Set<string>()
    const visit = (n: ts.Node): void => {
      if (isProcessEnv(n)) {
        const key = envKey(n.parent)
        const label = key ? `process.env.${key}` : "process.env"
        if (!seen.has(label)) {
          seen.add(label)
          findings.push({
            rule: "node-reads-env",
            severity: "warning",
            file,
            line: lineOf(n),
            message: `node reads ${label}`,
            fix: `Declare ${key ?? "the variable"} in the env schema of the provider that needs it (env: z.object({ ... })) and read that provider; boot then checks it once.`,
          })
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }

  // A renamed or moved node file leaves workflows pointing at nothing.
  const ws = await loadWorkspace(root)
  // A workflow file that doesn't parse, or a sub-workflow node that can't be
  // flattened (unknown port, a sub-workflow that uses itself).
  for (const e of ws.errors) {
    findings.push({
      rule: "workflow-load",
      severity: "error",
      file: relative(root, e.path).replaceAll("\\", "/"),
      message: e.message,
      fix: "Fix the file; the dev server and lorien build skip it until then.",
    })
  }
  const files = [
    ...ws.workflows.map((wf) => ({ relativePath: wf.relativePath, file: wf.source ?? wf.file })),
    ...Object.values(ws.subworkflows),
  ]
  for (const wf of files) {
    for (const [id, inst] of Object.entries(wf.file.nodes)) {
      if (inst.uses.startsWith("@") || (await nodeFileExists(root, inst.uses))) continue
      findings.push({
        rule: "workflow-uses",
        severity: "error",
        file: wf.relativePath,
        message: `${id} uses \`${inst.uses}\`, but there is no such node file.`,
        fix: "If you renamed or moved the node, update `uses` to its new path (no extension).",
      })
    }
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0))
  return {
    findings,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
  }
}

/** One finding as `file:line  severity  message` plus its fix, for a terminal. */
export function formatFinding(f: CheckFinding): string {
  const where = f.line ? `${f.file}:${f.line}` : f.file
  return `${f.severity === "error" ? "✗" : "!"} ${where}  ${f.message}\n    ${f.fix}`
}

/** `pg` for "pg", `@scope/pkg` for "@scope/pkg/sub"; undefined for relative and built-in imports. */
function packageOf(spec: string): string | undefined {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) {
    return spec === "node:sqlite" ? "node:sqlite" : undefined
  }
  const parts = spec.split("/")
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

function isProcessEnv(n: ts.Node): n is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(n) &&
    n.name.text === "env" &&
    ts.isIdentifier(n.expression) &&
    n.expression.text === "process"
  )
}

/** `FOO` in `process.env.FOO` or `process.env["FOO"]`. */
function envKey(parent: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(parent)) return parent.name.text
  if (ts.isElementAccessExpression(parent) && ts.isStringLiteralLike(parent.argumentExpression)) {
    return parent.argumentExpression.text
  }
  return undefined
}

/** Named exports that are functions: `export function f`, `export const f = () => ...`. */
function exportedFunctions(source: string, fileName: string): { name: string; line: number }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const exported = (s: ts.Statement) =>
    ts.canHaveModifiers(s) &&
    (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
    !(ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
  const out: { name: string; line: number }[] = []
  for (const stmt of sf.statements) {
    if (!exported(stmt)) continue
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      out.push({ name: stmt.name.text, line: lineOf(stmt) })
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        const init = d.initializer
        if (
          ts.isIdentifier(d.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          out.push({ name: d.name.text, line: lineOf(stmt) })
        }
      }
    }
  }
  return out
}

async function nodeFileExists(root: string, uses: string): Promise<boolean> {
  for (const ext of [".ts", ".mts", ".js", ".mjs", ".workflow"]) {
    try {
      if ((await stat(join(root, `${uses}${ext}`))).isFile()) return true
    } catch {
      // Try the next extension.
    }
  }
  return false
}
