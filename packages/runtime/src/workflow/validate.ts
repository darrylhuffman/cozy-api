import { resolveInputValue } from "./reference.js"
import type { WorkflowFile } from "./types.js"

export interface ValidationError {
  nodeId: string
  field: string
  message: string
}

export interface ValidationResult {
  errors: ValidationError[]
  /** Adjacency: dependencies of each node (referenced nodes + after listings). */
  depsByNode: Map<string, Set<string>>
}

export function validateWorkflow(wf: WorkflowFile): ValidationResult {
  const errors: ValidationError[] = []
  const depsByNode = new Map<string, Set<string>>()

  for (const [nodeId, instance] of Object.entries(wf.nodes)) {
    const deps = new Set<string>()
    depsByNode.set(nodeId, deps)

    // Resolve references in `in` block
    if (instance.in) {
      for (const [field, raw] of Object.entries(instance.in)) {
        const resolved = resolveInputValue(raw)
        if (resolved.kind === "reference") {
          if (!wf.nodes[resolved.ref.nodeId]) {
            errors.push({
              nodeId,
              field,
              message: `references unknown node \`${resolved.ref.nodeId}\``,
            })
          } else {
            deps.add(resolved.ref.nodeId)
          }
        }
      }
    }

    // After constraints
    if (instance.after) {
      for (const target of instance.after) {
        if (!wf.nodes[target]) {
          errors.push({
            nodeId,
            field: "after",
            message: `references unknown node \`${target}\` in after[]`,
          })
        } else {
          deps.add(target)
        }
      }
    }
  }

  // Cycle detection — DFS with coloring
  if (errors.length === 0) {
    const WHITE = 0
    const GRAY = 1
    const BLACK = 2
    const color = new Map<string, number>()
    for (const id of Object.keys(wf.nodes)) color.set(id, WHITE)

    const visit = (id: string, stack: string[]): boolean => {
      const c = color.get(id) ?? WHITE
      if (c === GRAY) {
        const cycleStart = stack.indexOf(id)
        const cycle = stack.slice(cycleStart).concat(id)
        errors.push({
          nodeId: id,
          field: "in",
          message: `cycle detected: ${cycle.join(" -> ")}`,
        })
        return true
      }
      if (c === BLACK) return false
      color.set(id, GRAY)
      stack.push(id)
      for (const dep of depsByNode.get(id) ?? []) {
        if (visit(dep, stack)) return true
      }
      stack.pop()
      color.set(id, BLACK)
      return false
    }

    for (const id of Object.keys(wf.nodes)) {
      if (visit(id, [])) break
    }
  }

  return { errors, depsByNode }
}
