import type { NodeInstance, WorkflowFile } from "@/lib/api"
import { scrubReferencesTo } from "./scrub-references"

/**
 * Strip the node's `in:` block (clear all incoming connections) AND remove any
 * `in:` references in OTHER nodes that pointed at this node.
 * The node itself and its position remain; only connections are reset.
 * Returns the original `wf` unchanged when `id` is absent.
 */
export function resetNodeConnections(wf: WorkflowFile, id: string): WorkflowFile {
  if (!wf.nodes[id]) return wf

  const nextNodes: Record<string, NodeInstance> = {}

  for (const [otherId, instance] of Object.entries(wf.nodes)) {
    if (otherId === id) {
      // Drop this node's own `in:` block; keep everything else
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { in: _drop, ...rest } = instance
      nextNodes[otherId] = rest
    } else {
      // Strip any references pointing AT `id` from other nodes
      nextNodes[otherId] = scrubReferencesTo(instance, id)
    }
  }

  return { ...wf, nodes: nextNodes }
}
