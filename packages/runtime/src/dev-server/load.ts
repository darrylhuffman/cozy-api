import { readdir, readFile, stat } from "node:fs/promises"
import { extname, join, relative } from "node:path"
import type { AnyNodeOrTrigger } from "../types.js"
import {
  flattenedOrigins,
  flattenWorkflow,
  type NodeOrigins,
  SubworkflowError,
  type SubworkflowMap,
  subworkflowUses,
} from "../workflow/flatten.js"
import { parseWorkflowFromString } from "../workflow/parse.js"
import type { WorkflowFile } from "../workflow/types.js"

export interface LoadedWorkflow {
  relativePath: string
  absolutePath: string
  /** What runs: the file with its sub-workflow nodes flattened in. */
  file: WorkflowFile
  /** The file as written, when flattening changed it. */
  source?: WorkflowFile
  /** Where each node brought in from a sub-workflow was written, when there are any. */
  origins?: NodeOrigins
}

export interface LoadedWorkspace {
  root: string
  workflows: LoadedWorkflow[]
  /** The `.workflow` files under nodes/, by `uses` key ("./nodes/orders/reserve-seats"). */
  subworkflows: SubworkflowMap
  /** Map from a `uses` reference (e.g. "./nodes/foo") to its loaded Node/Trigger. */
  nodes: Record<string, AnyNodeOrTrigger>
  errors: Array<{ path: string; message: string }>
}

export async function loadWorkspace(root: string): Promise<LoadedWorkspace> {
  const workflows: LoadedWorkflow[] = []
  const errors: LoadedWorkspace["errors"] = []
  const subworkflows = await loadSubworkflows(root, errors)

  const workflowsDir = join(root, "workflows")
  if (await exists(workflowsDir)) {
    for await (const abs of walk(workflowsDir, ".workflow")) {
      try {
        const text = await readFile(abs, "utf-8")
        const source = parseWorkflowFromString(text)
        let file: WorkflowFile
        try {
          file = flattenWorkflow(source, subworkflows)
        } catch (e) {
          if (!(e instanceof SubworkflowError)) throw e
          throw new Error(`${e.nodeId}.${e.field}: ${e.message}`)
        }
        const relativePath = relative(root, abs).replaceAll("\\", "/")
        workflows.push({
          absolutePath: abs,
          relativePath,
          file,
          ...(file !== source
            ? { source, origins: flattenedOrigins(source, relativePath, subworkflows) }
            : {}),
        })
      } catch (e) {
        errors.push({ path: abs, message: (e as Error).message })
      }
    }
  }

  // Node modules are loaded lazily by the dev server (it imports them on demand).
  // We don't pre-load them here because Node ESM dynamic imports must happen at use site.
  const nodes: Record<string, AnyNodeOrTrigger> = {}

  return { root, workflows, subworkflows, nodes, errors }
}

/**
 * Parses every `.workflow` file under nodes/. Each is a sub-workflow, used as
 * `./nodes/<path>` like a TypeScript node, so a name both kinds claim is an error.
 */
export async function loadSubworkflows(
  root: string,
  errors: Array<{ path: string; message: string }> = [],
): Promise<SubworkflowMap> {
  const subworkflows: SubworkflowMap = {}
  const nodesDir = join(root, "nodes")
  if (!(await exists(nodesDir))) return subworkflows
  for await (const abs of walk(nodesDir, ".workflow")) {
    const relativePath = relative(root, abs).replaceAll("\\", "/")
    const uses = subworkflowUses(relativePath)
    try {
      const clash = await firstExisting(abs.replace(/\.workflow$/, ""), [
        ".ts",
        ".mts",
        ".js",
        ".mjs",
      ])
      if (clash) {
        errors.push({
          path: abs,
          message: `\`${uses}\` is both a sub-workflow and ${relative(root, clash)}; rename one of them`,
        })
        continue
      }
      const file = parseWorkflowFromString(await readFile(abs, "utf-8"))
      subworkflows[uses] = { uses, relativePath, file }
    } catch (e) {
      errors.push({ path: abs, message: (e as Error).message })
    }
  }
  return subworkflows
}

/**
 * Reads `workflows/<name>.workflow` (or any project-relative `.workflow` path)
 * with its sub-workflows flattened in, ready for testWorkflow / traceWorkflow.
 */
export async function loadWorkflowFile(root: string, path: string): Promise<WorkflowFile> {
  const rel = path.endsWith(".workflow") ? path : `workflows/${path}.workflow`
  const source = parseWorkflowFromString(await readFile(join(root, rel), "utf-8"))
  return flattenWorkflow(source, await loadSubworkflows(root))
}

async function firstExisting(base: string, extensions: string[]): Promise<string | null> {
  for (const ext of extensions) {
    if (await exists(base + ext)) return base + ext
  }
  return null
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
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
