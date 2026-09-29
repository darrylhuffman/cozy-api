import type { NodeInstance } from "@/lib/api"
import type { NodePorts, PortNode } from "./derive-ports"

/**
 * Compute the initial expansion state for a node's input/output port trees.
 *
 * Returns the set of EXPANDED parent paths for inputs and outputs. A path P
 * being in the set means "the children of P are currently rendered." The root
 * path is "" (empty string).
 *
 * Defaults:
 *  - INPUTS root: collapsed when fully satisfied (every required field has a
 *    binding in `in:`) or when `in:` is the whole-object string form; expanded
 *    otherwise (partial / empty). Nested input branches default collapsed.
 *  - OUTPUTS: every branch is expanded by default. The user can collapse
 *    manually; that override persists for the session.
 *
 * "Required fields" are inferred from the synthetic root's children — every
 * top-level child of the input root counts as a required slot. (Future: read
 * `required` from the schema for finer granularity.)
 */
export function computeInitialExpansion(
  ports: NodePorts,
  instance: NodeInstance,
): {
  inputs: Set<string>
  outputs: Set<string>
} {
  return {
    inputs: computeInitialInputExpansion(ports.inputs, instance.in, instance.values),
    outputs: computeInitialOutputExpansion(ports.outputs),
  }
}

/**
 * Returns the initial expanded set for the inputs side.
 *
 * - When `in:` is a string (whole-object form), the per-field tree is moot — keep
 *   the root collapsed.
 * - When every top-level child is bound in `in:` OR in `values:`, the root
 *   collapses (it's "satisfied").
 * - Otherwise the root expands so the user can see what's missing.
 *
 * Nested branches under the root default to COLLAPSED — we don't preemptively
 * unfurl deeply nested schemas; the user opens what they need.
 */
export function computeInitialInputExpansion(
  inputRoot: PortNode,
  nodeIn: NodeInstance["in"],
  nodeValues: NodeInstance["values"],
): Set<string> {
  // Empty leaf root (e.g. trigger nodes) — nothing to expand.
  if (inputRoot.children.length === 0) return new Set()

  // Whole-object `in:` (string form) — no per-field bindings to inspect.
  if (typeof nodeIn === "string") return new Set()

  const filled = new Set<string>()
  if (nodeIn && typeof nodeIn !== "string") {
    for (const k of Object.keys(nodeIn)) filled.add(k)
  }
  if (nodeValues) {
    for (const k of Object.keys(nodeValues)) filled.add(k)
  }
  const requiredFields = inputRoot.children.map((c) => c.label)
  const allSatisfied =
    requiredFields.length > 0 && requiredFields.every((r) => filled.has(r))

  // Fully satisfied → collapsed; partial/empty → expanded.
  return allSatisfied ? new Set() : new Set([""])
}

/**
 * Returns the initial expanded set for the outputs side: schema-declared
 * branches start expanded; INFERRED branches (synthesised from references
 * into an opaque output) start collapsed so the inferred structure stays
 * hidden until the user opens it.
 *
 * Output trees are presented as an array of top-level ports (no synthetic
 * root), so the implicit "root" is not part of the expansion model — each
 * top-level branch must explicitly appear in the set to show its children.
 */
export function computeInitialOutputExpansion(outputs: PortNode[]): Set<string> {
  const expanded = new Set<string>()
  const walk = (port: PortNode): void => {
    if (port.children.length === 0) return
    if (port.inferred) return
    expanded.add(port.id)
    for (const child of port.children) walk(child)
  }
  for (const top of outputs) walk(top)
  return expanded
}
