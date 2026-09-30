import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"

/**
 * Renaming and deleting workflows and nodes from the IDE's explorer.
 *
 * A workflow travels with its saved requests (`add.workflow` →
 * `add.requests.json`) and a node with its test cases (`add-pet.ts` →
 * `add-pet.cases.json`). Renaming a node also rewrites every workflow's
 * `uses: "./nodes/…"` that points at it, so nothing is left dangling.
 */

export class WorkspaceItemError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message)
  }
}

type ItemKind = "workflow" | "node"

export interface RenameResult {
  /** Every file moved, as [from, to] workspace-relative paths. */
  moved: Array<[string, string]>
  /** Workflows whose `uses` were rewritten for a renamed node. */
  updatedWorkflows: string[]
}

export interface DeleteResult {
  deleted: string[]
}

export interface ItemUsage {
  /** Workflows that use this node (always empty for a workflow). */
  usedBy: string[]
}

function kindOf(path: string): ItemKind {
  if (path.startsWith("workflows/") && path.endsWith(".workflow")) return "workflow"
  if (path.startsWith("nodes/") && /\.ts$/.test(path) && !/\.(test|spec|d)\.ts$/.test(path)) {
    return "node"
  }
  throw new WorkspaceItemError(
    "Only .workflow files under workflows/ and node .ts files under nodes/ can be renamed or deleted",
    400,
  )
}

function companionOf(path: string, kind: ItemKind): string {
  return kind === "workflow"
    ? path.replace(/\.workflow$/, ".requests.json")
    : path.replace(/\.ts$/, ".cases.json")
}

/** `nodes/pets/add-pet.ts` → `./nodes/pets/add-pet` */
function usesOf(nodePath: string): string {
  return `./${nodePath.replace(/\.ts$/, "")}`
}

function inside(root: string, rel: string): string {
  const abs = resolve(root, rel)
  if (!abs.startsWith(root + sep)) throw new WorkspaceItemError("Path traversal denied", 403)
  return abs
}

async function exists(abs: string): Promise<boolean> {
  try {
    await access(abs)
    return true
  } catch {
    return false
  }
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "")
}

export async function renameWorkspaceItem(
  root: string,
  fromRaw: string,
  toRaw: string,
): Promise<RenameResult> {
  const from = normalize(fromRaw)
  const to = normalize(toRaw)
  const kind = kindOf(from)
  if (kindOf(to) !== kind) throw new WorkspaceItemError("Can't change a file's type", 400)
  if (from === to) return { moved: [], updatedWorkflows: [] }

  const fromAbs = inside(root, from)
  const toAbs = inside(root, to)
  if (!(await exists(fromAbs))) throw new WorkspaceItemError(`${from} not found`, 404)
  const pairs: Array<[string, string]> = [[from, to]]
  const companion = companionOf(from, kind)
  if (await exists(inside(root, companion))) pairs.push([companion, companionOf(to, kind)])
  for (const [, target] of pairs) {
    if (await exists(inside(root, target))) {
      throw new WorkspaceItemError(`${target} already exists`, 409)
    }
  }

  await mkdir(dirname(toAbs), { recursive: true })
  for (const [a, b] of pairs) await rename(inside(root, a), inside(root, b))

  const updatedWorkflows = kind === "node" ? await rewriteUses(root, usesOf(from), usesOf(to)) : []
  return { moved: pairs, updatedWorkflows }
}

export async function deleteWorkspaceItem(root: string, raw: string): Promise<DeleteResult> {
  const path = normalize(raw)
  const kind = kindOf(path)
  const abs = inside(root, path)
  if (!(await exists(abs))) throw new WorkspaceItemError(`${path} not found`, 404)
  const deleted = [path]
  await rm(abs)
  const companion = companionOf(path, kind)
  if (await exists(inside(root, companion))) {
    await rm(inside(root, companion))
    deleted.push(companion)
  }
  return { deleted }
}

export async function workspaceItemUsage(root: string, raw: string): Promise<ItemUsage> {
  const path = normalize(raw)
  if (kindOf(path) !== "node") return { usedBy: [] }
  const uses = usesOf(path)
  const usedBy: string[] = []
  for (const wf of await workflowFiles(root)) {
    const parsed = await readWorkflow(root, wf)
    if (parsed && Object.values(parsed.nodes).some((n) => n.uses === uses)) usedBy.push(wf)
  }
  return { usedBy }
}

interface WorkflowJson {
  nodes: Record<string, { uses?: string }>
}

async function readWorkflow(root: string, rel: string): Promise<WorkflowJson | null> {
  try {
    const parsed = JSON.parse(await readFile(join(root, rel), "utf-8")) as unknown
    if (!parsed || typeof parsed !== "object") return null
    const nodes = (parsed as { nodes?: unknown }).nodes
    if (!nodes || typeof nodes !== "object") return null
    return parsed as WorkflowJson
  } catch {
    return null
  }
}

async function rewriteUses(root: string, from: string, to: string): Promise<string[]> {
  const updated: string[] = []
  for (const wf of await workflowFiles(root)) {
    const parsed = await readWorkflow(root, wf)
    if (!parsed) continue
    let changed = false
    for (const node of Object.values(parsed.nodes)) {
      if (node.uses === from) {
        node.uses = to
        changed = true
      }
    }
    if (!changed) continue
    // Same format the IDE saves workflows in.
    await writeFile(join(root, wf), `${JSON.stringify(parsed, null, 2)}\n`, "utf-8")
    updated.push(wf)
  }
  return updated
}

async function workflowFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string) => {
    let entries: import("node:fs").Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const abs = join(dir, e.name)
      if (e.isDirectory()) await walk(abs)
      else if (e.name.endsWith(".workflow")) out.push(relative(root, abs).replace(/\\/g, "/"))
    }
  }
  await walk(join(root, "workflows"))
  return out.sort()
}
