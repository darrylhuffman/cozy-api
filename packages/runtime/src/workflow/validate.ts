import { parseReference } from "./reference.js"
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

    // `in:` is references-only. Each entry must parse as a node reference and
    // point at a known node id.
    if (instance.in !== undefined) {
      if (typeof instance.in === "string") {
        // Whole-object form: the entire input is a single reference.
        const ref = parseReference(instance.in)
        if (!ref) {
          errors.push({
            nodeId,
            field: "in",
            message: `whole-object \`in\` must be a node reference, got: ${JSON.stringify(instance.in)}`,
          })
        } else if (!wf.nodes[ref.nodeId]) {
          errors.push({
            nodeId,
            field: "in",
            message: `references unknown node \`${ref.nodeId}\``,
          })
        } else {
          deps.add(ref.nodeId)
        }
      } else {
        for (const [field, raw] of Object.entries(instance.in)) {
          // The schema already constrains values to strings; defend against the
          // pathological case where a non-conforming workflow slipped through.
          if (typeof raw !== "string") {
            errors.push({
              nodeId,
              field,
              message: `per-field \`in\` value must be a reference string, got ${typeof raw}`,
            })
            continue
          }
          const ref = parseReference(raw)
          if (!ref) {
            errors.push({
              nodeId,
              field,
              message: `not a valid node reference: ${JSON.stringify(raw)}`,
            })
            continue
          }
          if (!wf.nodes[ref.nodeId]) {
            errors.push({
              nodeId,
              field,
              message: `references unknown node \`${ref.nodeId}\``,
            })
          } else {
            deps.add(ref.nodeId)
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
