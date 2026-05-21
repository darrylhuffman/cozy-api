import type { NodeInstance, WorkflowFile } from "@/lib/api"
import type { PathMapping } from "./path-edge"

/**
 * Given a list of source→target path mappings, remove the corresponding
 * entries from each target node's `in:` block. `target` of "node" (no dot)
 * means whole-object form; "node.field" means per-field.
 */
export function removeMappings(wf: WorkflowFile, mappings: PathMapping[]): WorkflowFile {
  // Group by target nodeId
  const byTarget = new Map<string, PathMapping[]>()
  for (const m of mappings) {
    const [tNode] = m.target.split(".", 1)
    if (!tNode) continue
    if (!byTarget.has(tNode)) byTarget.set(tNode, [])
    byTarget.get(tNode)!.push(m)
  }

  const nextNodes: Record<string, NodeInstance> = { ...wf.nodes }
  for (const [tNode, group] of byTarget) {
    const inst = nextNodes[tNode]
    if (!inst || !inst.in) continue
    nextNodes[tNode] = applyMappingRemovals(inst, group)
  }
  return { ...wf, nodes: nextNodes }
}

function applyMappingRemovals(inst: NodeInstance, mappings: PathMapping[]): NodeInstance {
  if (typeof inst.in === "string") {
    // Any mapping with target = nodeId (no dot) clears the string
    const wholeObjectHit = mappings.some((m) => !m.target.includes("."))
    if (!wholeObjectHit) return inst
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { in: _drop, ...rest } = inst
    return rest
  }
  const nextIn: Record<string, unknown> = { ...inst.in }
  for (const m of mappings) {
    const [, ...rest] = m.target.split(".")
    const field = rest.join(".")
    if (!field) continue
    // Only delete if the current value matches the mapping's source
    if (nextIn[field] === m.source) delete nextIn[field]
  }
  if (Object.keys(nextIn).length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { in: _drop, ...withoutIn } = inst
    return withoutIn
  }
  return { ...inst, in: nextIn }
}
