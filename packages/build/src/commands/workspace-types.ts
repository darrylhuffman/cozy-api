import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { dirname, join, relative } from "node:path"

/** One type file for the IDE's code editor, keyed by a virtual path. */
export interface WorkspaceTypeFile {
  /** e.g. "node_modules/zod/index.d.cts" or ".lorien/types/services.d.ts" */
  path: string
  content: string
}

export interface WorkspaceTypes {
  files: WorkspaceTypeFile[]
  /** Packages that were dropped because the size budget ran out. */
  skipped: string[]
}

/**
 * Tooling packages whose declarations the editor never needs: TypeScript's
 * own lib files duplicate what Monaco ships, and the rest are CLIs.
 */
const IGNORED_PACKAGES = new Set(["typescript", "tsx", "@darrylondil/lorien-build"])

/** Total bytes of declarations sent to the browser. */
const DEFAULT_BUDGET = 24 * 1024 * 1024

const DECLARATION = /\.d\.(ts|mts|cts)$/

const SOURCE = /\.(ts|mts|cts)$/

/** Top-level folders whose sources are not shared code for node files. */
const SKIPPED_SOURCE_DIRS = new Set(["nodes", "workflows", "dist", "build", "coverage"])

/**
 * Collects the declaration files the code editor needs to type-check node
 * sources the way `tsc` would: every package the workspace depends on (and
 * the packages those depend on), plus generated types under `.lorien/types`.
 *
 * Packages are flattened to `node_modules/<name>/…` so the editor can resolve
 * them from any file, and are visited breadth-first so the workspace's own
 * dependencies always fit inside the budget before deep transitive ones.
 */
export async function collectWorkspaceTypes(
  root: string,
  budget: number = DEFAULT_BUDGET,
): Promise<WorkspaceTypes> {
  const files: WorkspaceTypeFile[] = []
  const skipped: string[] = []
  let used = 0

  for (const abs of await walk(join(root, ".lorien", "types"), DECLARATION)) {
    const content = await readFile(abs, "utf-8")
    used += content.length
    files.push({ path: toPosix(relative(root, abs)), content })
  }

  // The project's own shared sources (src/db.ts, src/schemas.ts, …) so node
  // files can import them. Nodes and workflows are left out: the editor opens
  // those as models, and a second copy under the same path would clash.
  for (const abs of await walk(root, SOURCE)) {
    const path = toPosix(relative(root, abs))
    const top = path.split("/")[0] ?? ""
    if (path.split("/").length > 1 && SKIPPED_SOURCE_DIRS.has(top)) continue
    if (/\.(test|spec)\.[cm]?ts$/.test(path)) continue
    const content = await readFile(abs, "utf-8")
    used += content.length
    files.push({ path, content })
  }

  const rootPkg = await readJson(join(root, "package.json"))
  const queue: { name: string; from: string }[] = dependencyNames(rootPkg, true).map((name) => ({
    name,
    from: root,
  }))
  const seen = new Set<string>()

  while (queue.length > 0) {
    const next = queue.shift()
    if (!next || seen.has(next.name) || IGNORED_PACKAGES.has(next.name)) continue
    seen.add(next.name)
    const dir = await findPackageDir(next.name, next.from)
    if (!dir) continue

    const pkgFiles: WorkspaceTypeFile[] = []
    let size = 0
    for (const abs of await walk(dir, /(^|[/\\])package\.json$|\.d\.(ts|mts|cts)$/)) {
      const content = await readFile(abs, "utf-8")
      size += content.length
      pkgFiles.push({ path: `node_modules/${next.name}/${toPosix(relative(dir, abs))}`, content })
    }
    if (used + size > budget) {
      skipped.push(next.name)
      continue
    }
    used += size
    files.push(...pkgFiles)

    const pkg = await readJson(join(dir, "package.json"))
    for (const name of dependencyNames(pkg, false)) queue.push({ name, from: dir })
  }

  return { files, skipped }
}

function dependencyNames(pkg: Record<string, unknown> | null, includeDev: boolean): string[] {
  if (!pkg) return []
  const fields = ["dependencies", "peerDependencies", ...(includeDev ? ["devDependencies"] : [])]
  const optional = (pkg.peerDependenciesMeta ?? {}) as Record<string, { optional?: boolean }>
  const names: string[] = []
  for (const field of fields) {
    const deps = pkg[field]
    if (!deps || typeof deps !== "object") continue
    for (const name of Object.keys(deps)) {
      // Optional peers (jsdom for vitest, etc.) are only there if the workspace asked for them.
      if (field === "peerDependencies" && optional[name]?.optional) continue
      names.push(name)
    }
  }
  return names
}

/**
 * Node-style lookup: the nearest `node_modules/<name>` walking up from `from`.
 * Returns the real path so pnpm's symlinked layout resolves each package's own
 * dependencies from its store directory.
 */
async function findPackageDir(name: string, from: string): Promise<string | null> {
  let dir = from
  for (;;) {
    const candidate = join(dir, "node_modules", name)
    if (await isFile(join(candidate, "package.json"))) return realpath(candidate)
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Files under `dir` matching `pattern`, skipping nested node_modules and dot folders. */
async function walk(dir: string, pattern: RegExp): Promise<string[]> {
  let entries: import("node:fs").Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      out.push(...(await walk(abs, pattern)))
    } else if (entry.isFile() && pattern.test(abs)) {
      out.push(abs)
    }
  }
  return out
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>
  } catch {
    return null
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function toPosix(p: string): string {
  return p.replaceAll("\\", "/")
}
