import type { NodeInstance, WorkflowFile } from "@/lib/api"

/**
 * Removes a node from the workflow and strips any `in:` references in other
 * nodes that pointed at it. Supports both per-field (`in: {...}`) and
 * whole-object (`in: "..."`) forms. Returns the original wf if id is absent.
 */
export function deleteNode(wf: WorkflowFile, id: string): WorkflowFile {
  if (!wf.nodes[id]) return wf
  const { [id]: _gone, ...remaining } = wf.nodes

  const scrubbedNodes: Record<string, NodeInstance> = {}
  for (const [otherId, instance] of Object.entries(remaining)) {
    scrubbedNodes[otherId] = scrubReferences(instance, id)
  }

  const view = wf.view ? { ...wf.view } : undefined
  if (view) delete view[id]

  const out: WorkflowFile = { ...wf, nodes: scrubbedNodes }
  if (view) out.view = view
  return out
}

function scrubReferences(node: NodeInstance, deletedId: string): NodeInstance {
  if (!node.in) return node
  if (typeof node.in === "string") {
    if (node.in === deletedId || node.in.startsWith(`${deletedId}.`)) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { in: _drop, ...rest } = node
      return rest
    }
    return node
  }
  // per-field object form
  const nextIn: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(node.in)) {
    if (typeof value === "string" && (value === deletedId || value.startsWith(`${deletedId}.`))) {
      continue // strip
    }
    nextIn[field] = value
  }
  if (Object.keys(nextIn).length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { in: _drop, ...rest } = node
    return rest
  }
  return { ...node, in: nextIn }
}
