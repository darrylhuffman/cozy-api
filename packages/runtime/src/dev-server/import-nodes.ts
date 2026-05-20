import { readdir, stat } from "node:fs/promises"
import { extname, join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import type { AnyNodeOrTrigger } from "../types.js"

export interface ImportNodesResult {
  /** Map from "uses" key (e.g. "./nodes/foo") to the imported Node/Trigger. */
  nodes: Record<string, AnyNodeOrTrigger>
  /** Files that failed to import or didn't have a usable default export. */
  errors: Array<{ path: string; message: string }>
}

/**
 * Walks `<root>/nodes/**` for `.ts` files. Dynamic-imports each; captures the
 * default export if it's a Node or Trigger (i.e. `kind` is "node" or "trigger").
 *
 * The `uses` key is the project-relative path with `.ts` stripped, prefixed with `./`.
 * Examples:
 *   <root>/nodes/say-hello.ts        -> "./nodes/say-hello"
 *   <root>/nodes/users/save.ts       -> "./nodes/users/save"
 */
export async function importNodes(root: string): Promise<ImportNodesResult> {
  const nodes: Record<string, AnyNodeOrTrigger> = {}
  const errors: ImportNodesResult["errors"] = []

  const nodesDir = join(root, "nodes")
  if (!(await dirExists(nodesDir))) {
    return { nodes, errors }
  }

  for await (const abs of walk(nodesDir, ".ts")) {
    // Skip test files
    if (abs.endsWith(".test.ts") || abs.endsWith(".test-d.ts")) continue

    try {
      const mod = (await import(pathToFileURL(abs).href)) as { default?: unknown }
      const def = mod.default
      if (!def || typeof def !== "object") {
        errors.push({ path: abs, message: "no default export, or default is not an object" })
        continue
      }
      const kind = (def as { kind?: string }).kind
      if (kind !== "node" && kind !== "trigger") {
        errors.push({
          path: abs,
          message: "default export is not a Node or Trigger (missing kind field)",
        })
        continue
      }
      const usesKey = `./${relative(root, abs).replaceAll("\\", "/").replace(/\.ts$/, "")}`
      nodes[usesKey] = def as AnyNodeOrTrigger
    } catch (e) {
      errors.push({ path: abs, message: (e as Error).message })
    }
  }

  return { nodes, errors }
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
