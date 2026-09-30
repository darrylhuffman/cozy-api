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
 *  - INPUTS root: expanded, unless `in:` is the whole-object string form.
 *    Nested input branches default collapsed.
 *  - OUTPUTS: every branch is expanded by default. The user can collapse
 *    manually; that override persists for the session.
 *
 */
export function computeInitialExpansion(
  ports: NodePorts,
  instance: NodeInstance,
): {
  inputs: Set<string>
  outputs: Set<string>
} {
  return {
    inputs: computeInitialInputExpansion(ports.inputs, instance.in),
    outputs: computeInitialOutputExpansion(ports.outputs),
  }
}

/**
 * Returns the initial expanded set for the inputs side.
 *
 * Inputs show their values on the card, so the root starts expanded. The one
 * exception is whole-object `in:` (string form): the node takes one upstream
 * value and the per-field rows add nothing. Nested branches start collapsed;
 * the user opens what they need.
 */
export function computeInitialInputExpansion(
  inputRoot: PortNode,
  nodeIn: NodeInstance["in"],
): Set<string> {
  // Empty leaf root (e.g. trigger nodes) — nothing to expand.
  if (inputRoot.children.length === 0) return new Set()
  if (typeof nodeIn === "string") return new Set()
  return new Set([""])
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
