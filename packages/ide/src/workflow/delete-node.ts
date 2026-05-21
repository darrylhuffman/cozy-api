import type { NodeInstance, WorkflowFile } from "@/lib/api"
import { scrubReferencesTo } from "./scrub-references"

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
    scrubbedNodes[otherId] = scrubReferencesTo(instance, id)
  }

  const view = wf.view ? { ...wf.view } : undefined
  if (view) delete view[id]

  const out: WorkflowFile = { ...wf, nodes: scrubbedNodes }
  if (view) out.view = view
  return out
}
