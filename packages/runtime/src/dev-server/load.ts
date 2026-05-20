import { readdir, readFile, stat } from "node:fs/promises"
import { extname, join, relative } from "node:path"
import type { AnyNodeOrTrigger } from "../types.js"
import { parseWorkflowFromString } from "../workflow/parse.js"
import type { WorkflowFile } from "../workflow/types.js"

export interface LoadedWorkflow {
  relativePath: string
  absolutePath: string
  file: WorkflowFile
}

export interface LoadedWorkspace {
  root: string
  workflows: LoadedWorkflow[]
  /** Map from a `uses` reference (e.g. "./nodes/foo") to its loaded Node/Trigger. */
  nodes: Record<string, AnyNodeOrTrigger>
  errors: Array<{ path: string; message: string }>
}

export async function loadWorkspace(root: string): Promise<LoadedWorkspace> {
  const workflows: LoadedWorkflow[] = []
  const errors: LoadedWorkspace["errors"] = []

  const workflowsDir = join(root, "workflows")
  if (await exists(workflowsDir)) {
    for await (const abs of walk(workflowsDir, ".workflow")) {
      try {
        const text = await readFile(abs, "utf-8")
        const file = parseWorkflowFromString(text)
        workflows.push({
          absolutePath: abs,
          relativePath: relative(workflowsDir, abs).replaceAll("\\", "/"),
          file,
        })
      } catch (e) {
        errors.push({ path: abs, message: (e as Error).message })
      }
    }
  }

  // Node modules are loaded lazily by the dev server (it imports them on demand).
  // We don't pre-load them here because Node ESM dynamic imports must happen at use site.
  const nodes: Record<string, AnyNodeOrTrigger> = {}

  return { root, workflows, nodes, errors }
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
