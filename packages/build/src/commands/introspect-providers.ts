import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { findProviderFiles } from "@darrylondil/lorien-runtime"
import * as ts from "typescript"

export type EnvVarStatus = "set" | "default" | "optional" | "missing"

export interface ProviderEnvVar {
  key: string
  status: EnvVarStatus
}

export interface ProviderInfo {
  /** The name nodes read it by, e.g. "db". */
  name: string
  /** Project-relative path, e.g. "providers/db.ts". */
  path: string
  /** `name` from defineProvider, for display. */
  label?: string
  color?: string
  lifetime: "singleton" | "scoped" | "transient"
  uses: string[]
  env: ProviderEnvVar[]
  hasDispose: boolean
  /** npm packages the provider (and its private folder) imports. */
  packages: string[]
  /** Node files that read this provider, e.g. "nodes/pets/add-pet.ts". */
  usedBy: string[]
}

export interface ProvidersIntrospection {
  providers: ProviderInfo[]
  /** Node `uses` key ("./nodes/pets/add-pet") → provider names its `run` reads. */
  nodes: Record<string, string[]>
}

/**
 * Reads `providers/*.ts` and `nodes/**` statically (TypeScript's parser, no
 * import), so the IDE always sees the files as they are on disk: each
 * provider's lifetime, deps, env vars and packages, and which providers each
 * node's `run` reads.
 */
export async function introspectProviders(
  root: string,
  env: Record<string, string | undefined> = process.env,
): Promise<ProvidersIntrospection> {
  const files = await findProviderFiles(root)
  const names = new Set(files.map((f) => f.name))

  const nodes: Record<string, string[]> = {}
  for (const abs of await walkTs(join(root, "nodes"))) {
    const rel = toPosix(relative(root, abs))
    const used = providersReadByNode(await readFile(abs, "utf-8"), names)
    nodes[`./${rel.replace(/\.ts$/, "")}`] = used
  }

  const providers: ProviderInfo[] = []
  for (const f of files) {
    const source = await readFile(join(root, f.path), "utf-8")
    const info = parseProvider(source, f.path, env)
    const privateDir = join(
      root,
      "providers",
      f.path.replace(/^providers\//, "").replace(/\.[mc]?[jt]s$/, ""),
    )
    const packages = new Set(info.packages)
    for (const abs of await walkTs(privateDir)) {
      for (const p of importedPackages(await readFile(abs, "utf-8"))) packages.add(p)
    }
    providers.push({
      name: f.name,
      path: f.path,
      ...info,
      packages: [...packages].sort(),
      usedBy: Object.entries(nodes)
        .filter(([, used]) => used.includes(f.name))
        .map(([uses]) => `${uses.slice(2)}.ts`)
        .sort(),
    })
  }
  return { providers, nodes }
}

type ParsedProvider = Omit<ProviderInfo, "name" | "path" | "usedBy">

export function parseProvider(
  source: string,
  fileName: string,
  env: Record<string, string | undefined> = {},
): ParsedProvider {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const out: ParsedProvider = {
    lifetime: "singleton",
    uses: [],
    env: [],
    hasDispose: false,
    packages: importedPackages(source),
  }
  const def = defineCallArgument(sf, "defineProvider")
  if (!def) return out
  for (const prop of def.properties) {
    const key = propName(prop)
    if (!key) continue
    const init = ts.isPropertyAssignment(prop) ? prop.initializer : undefined
    if (key === "name" && init && ts.isStringLiteralLike(init)) out.label = init.text
    if (key === "color" && init && ts.isStringLiteralLike(init)) out.color = init.text
    if (key === "lifetime" && init && ts.isStringLiteralLike(init)) {
      if (init.text === "scoped" || init.text === "transient") out.lifetime = init.text
    }
    if (key === "uses" && init && ts.isArrayLiteralExpression(init)) {
      out.uses = init.elements.filter(ts.isStringLiteralLike).map((e) => e.text)
    }
    if (key === "dispose") out.hasDispose = true
    if (key === "env" && init) out.env = envVars(init, env)
  }
  return out
}

/** Keys of `z.object({ ... })`, with whether each is set, defaulted or optional. */
function envVars(expr: ts.Expression, env: Record<string, string | undefined>): ProviderEnvVar[] {
  let obj: ts.ObjectLiteralExpression | undefined
  const find = (n: ts.Node): void => {
    if (obj) return
    if (ts.isCallExpression(n) && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
      obj = n.arguments[0]
      return
    }
    ts.forEachChild(n, find)
  }
  find(expr)
  if (!obj) return []
  const vars: ProviderEnvVar[] = []
  for (const prop of obj.properties) {
    const key = propName(prop)
    if (!key) continue
    const text = ts.isPropertyAssignment(prop) ? prop.initializer.getText() : ""
    let status: EnvVarStatus
    if (env[key] !== undefined && env[key] !== "") status = "set"
    else if (/\.default\(/.test(text)) status = "default"
    else if (/\.(optional|nullish)\(/.test(text)) status = "optional"
    else status = "missing"
    vars.push({ key, status })
  }
  return vars
}

/**
 * Provider names a node's `run` reads: destructured from its second
 * parameter (`run(input, { db })`) or accessed on it (`providers.db`).
 */
export function providersReadByNode(source: string, known: ReadonlySet<string>): string[] {
  const sf = ts.createSourceFile("node.ts", source, ts.ScriptTarget.Latest, true)
  const def = defineCallArgument(sf, "defineNode")
  if (!def) return []
  const run = def.properties.find((p) => propName(p) === "run")
  let fn: ts.FunctionLikeDeclaration | undefined
  if (run && ts.isMethodDeclaration(run)) fn = run
  else if (run && ts.isPropertyAssignment(run)) {
    const i = run.initializer
    if (ts.isArrowFunction(i) || ts.isFunctionExpression(i)) fn = i
  }
  const param = fn?.parameters[1]
  if (!fn || !param) return []

  const used = new Set<string>()
  if (ts.isObjectBindingPattern(param.name)) {
    for (const el of param.name.elements) {
      const name = el.propertyName ? propNameOf(el.propertyName) : el.name.getText()
      if (name) used.add(name)
    }
  } else if (ts.isIdentifier(param.name)) {
    const id = param.name.text
    const visit = (n: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === id
      ) {
        used.add(n.name.text)
      }
      if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer) {
        const init = ts.isAsExpression(n.initializer) ? n.initializer.expression : n.initializer
        if (ts.isIdentifier(init) && init.text === id) {
          for (const el of n.name.elements) {
            const name = el.propertyName ? propNameOf(el.propertyName) : el.name.getText()
            if (name) used.add(name)
          }
        }
      }
      ts.forEachChild(n, visit)
    }
    if (fn.body) visit(fn.body)
  }
  return [...used].filter((n) => known.has(n)).sort()
}

/** Bare package specifiers a file imports (`pg`, `@scope/pkg`), minus Node built-ins and lorien. */
export function importedPackages(source: string): string[] {
  const sf = ts.createSourceFile("file.ts", source, ts.ScriptTarget.Latest, true)
  const out = new Set<string>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    const spec = stmt.moduleSpecifier.text
    if (spec.startsWith(".") || spec.startsWith("node:") || spec.startsWith("/")) continue
    const parts = spec.split("/")
    const pkg = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!
    if (pkg === "@darrylondil/lorien-runtime" || pkg === "zod") continue
    out.add(pkg)
  }
  return [...out].sort()
}

function defineCallArgument(
  sf: ts.SourceFile,
  callee: string,
): ts.ObjectLiteralExpression | undefined {
  for (const stmt of sf.statements) {
    if (!ts.isExportAssignment(stmt) || stmt.isExportEquals) continue
    const e = stmt.expression
    if (
      ts.isCallExpression(e) &&
      ts.isIdentifier(e.expression) &&
      e.expression.text === callee &&
      e.arguments[0] &&
      ts.isObjectLiteralExpression(e.arguments[0])
    ) {
      return e.arguments[0]
    }
  }
  return undefined
}

function propName(p: ts.ObjectLiteralElementLike): string | undefined {
  return p.name ? propNameOf(p.name) : undefined
}

function propNameOf(n: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(n) || ts.isStringLiteralLike(n)) return n.text
  return undefined
}

async function walkTs(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) out.push(...(await walkTs(abs)))
    } else if (/\.[mc]?ts$/.test(e.name) && !/\.(test|spec|d)\.[mc]?ts$/.test(e.name)) {
      out.push(abs)
    }
  }
  return out.sort()
}

function toPosix(p: string): string {
  return p.replaceAll("\\", "/")
}
