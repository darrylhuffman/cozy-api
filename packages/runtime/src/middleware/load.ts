import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { isMiddleware, type Middleware } from "./define-middleware.js"

/** `_middleware.ts` (or .mts/.js/.mjs) inside `workflows/` or any folder below it. */
export const MIDDLEWARE_FILE = /^_middleware\.(ts|mts|js|mjs)$/

export interface MiddlewareFile {
  /** The folder it guards, project-relative: "workflows" or "workflows/admin". */
  dir: string
  /** Project-relative path, e.g. "workflows/admin/_middleware.ts". */
  path: string
}

/** Every `_middleware.ts` under `workflows/`, outermost first. */
export async function findMiddlewareFiles(root: string): Promise<MiddlewareFile[]> {
  const out: MiddlewareFile[] = []
  const walk = async (rel: string): Promise<void> => {
    let entries: import("node:fs").Dirent[]
    try {
      entries = await readdir(join(root, rel), { withFileTypes: true })
    } catch {
      return
    }
    const file = entries.find((e) => e.isFile() && MIDDLEWARE_FILE.test(e.name))
    if (file) out.push({ dir: rel, path: `${rel}/${file.name}` })
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
        await walk(`${rel}/${e.name}`)
      }
    }
  }
  await walk("workflows")
  return out.sort((a, b) => depth(a.dir) - depth(b.dir) || a.dir.localeCompare(b.dir))
}

/**
 * The middleware files that guard a workflow ("workflows/admin/stats.workflow"),
 * outermost folder first.
 */
export function middlewareChain<F extends { dir: string }>(workflowPath: string, files: F[]): F[] {
  const dir = workflowPath.split("/").slice(0, -1).join("/")
  return files
    .filter((f) => dir === f.dir || dir.startsWith(`${f.dir}/`))
    .sort((a, b) => depth(a.dir) - depth(b.dir))
}

function depth(dir: string): number {
  return dir.split("/").length
}

export interface ImportMiddlewareResult {
  /** Folder ("workflows/admin") → its middleware, in the order the file exports them. */
  byDir: Record<string, Middleware[]>
  errors: Array<{ path: string; message: string }>
}

/**
 * Imports every `_middleware.ts`. `fresh` bypasses the module cache so an
 * edited file is picked up on reload.
 */
export async function importMiddleware(
  root: string,
  opts: { fresh?: boolean } = {},
): Promise<ImportMiddlewareResult> {
  const byDir: Record<string, Middleware[]> = {}
  const errors: ImportMiddlewareResult["errors"] = []
  for (const f of await findMiddlewareFiles(root)) {
    try {
      const url = pathToFileURL(join(root, f.path)).href + (opts.fresh ? `?t=${Date.now()}` : "")
      const mod = (await import(url)) as { default?: unknown }
      const list = Array.isArray(mod.default) ? mod.default : [mod.default]
      if (list.length === 0 || !list.every(isMiddleware)) {
        errors.push({
          path: f.path,
          message: "default export must be defineMiddleware(...) or an array of them",
        })
        continue
      }
      byDir[f.dir] = list
    } catch (e) {
      errors.push({ path: f.path, message: (e as Error).message })
    }
  }
  return { byDir, errors }
}
