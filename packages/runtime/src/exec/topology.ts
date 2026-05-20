import type { WorkflowFile } from "../workflow/types.js"

export interface ExecutionPlan {
  /** Topological waves: every node in waves[i] can fire in parallel once waves[0..i-1] are done. */
  waves: string[][]
  /** For each trigger node, the set of nodes reachable forward (including the trigger itself). */
  reachableFrom: Map<string, Set<string>>
}

export function computeExecutionPlan(
  wf: WorkflowFile,
  depsByNode: Map<string, Set<string>>,
): ExecutionPlan {
  const allIds = Object.keys(wf.nodes)
  const remaining = new Map<string, Set<string>>()
  for (const id of allIds) {
    remaining.set(id, new Set(depsByNode.get(id) ?? []))
  }

  const waves: string[][] = []
  while (remaining.size > 0) {
    const wave: string[] = []
    for (const [id, deps] of remaining) {
      if (deps.size === 0) wave.push(id)
    }
    if (wave.length === 0) {
      throw new Error("computeExecutionPlan: stuck — possible cycle (validate first)")
    }
    waves.push(wave.sort())
    for (const id of wave) {
      remaining.delete(id)
      for (const deps of remaining.values()) {
        deps.delete(id)
      }
    }
  }

  // Reachable-from: BFS forward from each trigger node.
  const downstreamOf = new Map<string, Set<string>>()
  for (const id of allIds) downstreamOf.set(id, new Set())
  for (const [id, deps] of depsByNode) {
    for (const dep of deps) {
      downstreamOf.get(dep)?.add(id)
    }
  }

  const reachableFrom = new Map<string, Set<string>>()
  for (const id of allIds) {
    if (wf.nodes[id]?.uses.startsWith("@core/http-request")) {
      const reachable = new Set<string>([id])
      const queue: string[] = [id]
      while (queue.length > 0) {
        const cur = queue.shift()!
        for (const next of downstreamOf.get(cur) ?? []) {
          if (!reachable.has(next)) {
            reachable.add(next)
            queue.push(next)
          }
        }
      }
      reachableFrom.set(id, reachable)
    }
  }

  return { waves, reachableFrom }
}
