import type { WorkflowFile } from "../workflow/types.js"

/**
 * Build a workflow slice containing only the nodes relevant to a given trigger.
 *
 * Includes:
 * - The trigger node itself
 * - All nodes forward-reachable from the trigger (explicit subgraph)
 * - Orphan nodes (no trigger owns them) that are NOT @core/response nodes,
 *   unless the trigger's direct subgraph contains no response node at all
 *   (in that case orphan response nodes are included so the trigger still has
 *   a way to produce a response).
 *
 * This prevents a floating @core/response (e.g., one using only $literal values)
 * from short-circuiting a different trigger's response in multi-trigger workflows.
 */
export function buildTriggerSlice(
  wf: WorkflowFile,
  triggerNodeId: string,
  depsByNode: Map<string, Set<string>>,
): WorkflowFile {
  const allIds = Object.keys(wf.nodes)

  // Build downstream adjacency from deps.
  const downstreamOf = new Map<string, Set<string>>()
  for (const id of allIds) downstreamOf.set(id, new Set())
  for (const [id, deps] of depsByNode) {
    for (const dep of deps) {
      downstreamOf.get(dep)?.add(id)
    }
  }

  // BFS forward from all trigger nodes to compute each trigger's reachable set.
  const allTriggerIds = allIds.filter((id) => wf.nodes[id]?.uses === "@core/http-request")

  const reachableFrom = new Map<string, Set<string>>()
  for (const tid of allTriggerIds) {
    const reachable = new Set<string>([tid])
    const queue = [tid]
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const next of downstreamOf.get(cur) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next)
          queue.push(next)
        }
      }
    }
    reachableFrom.set(tid, reachable)
  }

  // Determine which nodes are "owned" by at least one trigger.
  const ownedByAnyTrigger = new Set<string>()
  for (const reachable of reachableFrom.values()) {
    for (const id of reachable) ownedByAnyTrigger.add(id)
  }

  const triggerReachable = reachableFrom.get(triggerNodeId) ?? new Set([triggerNodeId])

  // Check if the trigger already has a @core/response node in its explicit subgraph.
  const hasExplicitResponse = [...triggerReachable].some(
    (id) => id !== triggerNodeId && wf.nodes[id]?.uses === "@core/response",
  )

  // Build the included node set.
  const included = new Set<string>()
  for (const id of allIds) {
    if (triggerReachable.has(id)) {
      // Always include nodes in the trigger's explicit subgraph.
      included.add(id)
    } else if (!ownedByAnyTrigger.has(id)) {
      // Orphan node: include unless it's a response node and we already have one.
      const isResponse = wf.nodes[id]?.uses === "@core/response"
      if (!isResponse || !hasExplicitResponse) {
        included.add(id)
      }
    }
    // Nodes owned by OTHER triggers are excluded.
  }

  // Project the workflow to only the included nodes.
  const nodes: WorkflowFile["nodes"] = {}
  for (const id of included) {
    nodes[id] = wf.nodes[id]!
  }

  return { lorien: 1, nodes }
}

/** Extracts :param values from a Hono-style path against an actual pathname. */
export function extractParams(template: string, actual: string): Record<string, string> {
  const tParts = template.split("/").filter(Boolean)
  const aParts = actual.split("/").filter(Boolean)
  if (tParts.length !== aParts.length) return {}
  const params: Record<string, string> = {}
  for (let i = 0; i < tParts.length; i++) {
    const t = tParts[i]!
    const a = aParts[i]!
    if (t.startsWith(":")) params[t.slice(1)] = decodeURIComponent(a)
  }
  return params
}
