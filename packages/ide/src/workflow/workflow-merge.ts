import type { NodeInstance, WorkflowFile } from "@/lib/api"
import { inputRefs } from "./workflow-diff"

/**
 * A three-way merge of two versions of a workflow that share a base, in the
 * graph's own terms: changes to different nodes, or to different inputs of
 * the same node, combine on their own. Only a part both sides changed
 * differently is a conflict for a person to pick.
 */

export type MergeSide = "ours" | "theirs"

export interface WorkflowConflict {
  nodeId: string
  /** What conflicts: "node" when one side removed a node the other changed, else fields like "uses", "in.status", "values.limit". */
  fields: string[]
  ours: NodeInstance | undefined
  theirs: NodeInstance | undefined
  base: NodeInstance | undefined
}

export interface WorkflowMerge {
  /** The merged workflow with every conflict resolved as `choices` say (ours by default). */
  merged: WorkflowFile
  conflicts: WorkflowConflict[]
  /** Nodes whose changes from both sides combined without a conflict. */
  combined: string[]
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Picks between two changes to one value: whichever side changed it, or a conflict. */
function pick<T>(base: T, ours: T, theirs: T): { value: T; conflict: boolean } {
  if (same(ours, theirs)) return { value: ours, conflict: false }
  if (same(base, ours)) return { value: theirs, conflict: false }
  if (same(base, theirs)) return { value: ours, conflict: false }
  return { value: ours, conflict: true }
}

/** A node as its mergeable parts: whole-value keys, plus one entry per input and value. */
function parts(n: NodeInstance | undefined): Map<string, unknown> {
  const out = new Map<string, unknown>()
  if (!n) return out
  for (const [k, v] of Object.entries(n)) {
    if (k === "in" || k === "values") continue
    out.set(k, v)
  }
  for (const [field, ref] of Object.entries(inputRefs(n))) out.set(`in.${field}`, ref)
  for (const [field, v] of Object.entries(n.values ?? {})) out.set(`values.${field}`, v)
  return out
}

function fromParts(p: Map<string, unknown>): NodeInstance {
  const node: Record<string, unknown> = {}
  const refs: Record<string, string> = {}
  const values: Record<string, unknown> = {}
  for (const [k, v] of p) {
    if (v === undefined) continue
    if (k.startsWith("in.")) refs[k.slice(3)] = v as string
    else if (k.startsWith("values.")) values[k.slice(7)] = v
    else node[k] = v
  }
  const keys = Object.keys(refs)
  if (keys.length === 1 && keys[0] === "") node.in = refs[""]
  else if (keys.length > 0) node.in = refs
  if (Object.keys(values).length > 0) node.values = values
  return node as unknown as NodeInstance
}

/** Merges one node present on some side; `choice` settles its conflicting parts. */
function mergeNode(
  base: NodeInstance | undefined,
  ours: NodeInstance | undefined,
  theirs: NodeInstance | undefined,
  choice: MergeSide,
): { node: NodeInstance | undefined; fields: string[] } {
  // Removed on one side and changed on the other: the whole node is the conflict.
  if (!ours || !theirs) {
    const whole = pick(base, ours, theirs)
    if (!whole.conflict) return { node: whole.value, fields: [] }
    return { node: choice === "ours" ? ours : theirs, fields: ["node"] }
  }
  const b = parts(base)
  const o = parts(ours)
  const t = parts(theirs)
  const out = new Map<string, unknown>()
  const fields: string[] = []
  for (const key of new Set([...o.keys(), ...t.keys(), ...b.keys()])) {
    const r = pick(b.get(key), o.get(key), t.get(key))
    if (r.conflict) fields.push(key)
    out.set(key, r.conflict && choice === "theirs" ? t.get(key) : r.value)
  }
  return { node: fromParts(out), fields }
}

/**
 * Merges `ours` and `theirs` against `base`. `choices` picks a side for each
 * conflicting node (by id); unpicked conflicts take ours. Top-level keys
 * other than nodes and layout merge the same way, taking ours on a clash.
 */
export function mergeWorkflows(
  base: WorkflowFile | null,
  ours: WorkflowFile,
  theirs: WorkflowFile,
  choices: Record<string, MergeSide> = {},
): WorkflowMerge {
  const b = base ?? ({ lorien: 1, nodes: {} } as WorkflowFile)
  const conflicts: WorkflowConflict[] = []
  const combined: string[] = []
  const nodes: Record<string, NodeInstance> = {}

  // Ours' order first, then nodes only theirs added.
  const ids = [...new Set([...Object.keys(ours.nodes), ...Object.keys(theirs.nodes)])]
  for (const id of ids) {
    const bn = b.nodes[id]
    const on = ours.nodes[id]
    const tn = theirs.nodes[id]
    const { node, fields } = mergeNode(bn, on, tn, choices[id] ?? "ours")
    if (fields.length > 0) conflicts.push({ nodeId: id, fields, ours: on, theirs: tn, base: bn })
    else if (on && tn && !same(on, bn) && !same(tn, bn) && !same(on, tn)) combined.push(id)
    if (node) nodes[id] = node
  }

  // Layout: whichever side moved a node; ours when both did.
  const view: NonNullable<WorkflowFile["view"]> = {}
  for (const id of Object.keys(nodes)) {
    const pos = pick(b.view?.[id], ours.view?.[id], theirs.view?.[id]).value
    if (pos) view[id] = pos
  }

  const merged: Record<string, unknown> = {}
  const top = new Set([...Object.keys(ours), ...Object.keys(theirs)])
  for (const key of top) {
    if (key === "nodes" || key === "view") continue
    const v = pick(
      (b as unknown as Record<string, unknown>)[key],
      (ours as unknown as Record<string, unknown>)[key],
      (theirs as unknown as Record<string, unknown>)[key],
    ).value
    if (v !== undefined) merged[key] = v
  }
  merged.nodes = nodes
  if (Object.keys(view).length > 0 || ours.view || theirs.view) merged.view = view
  return { merged: merged as unknown as WorkflowFile, conflicts, combined }
}
