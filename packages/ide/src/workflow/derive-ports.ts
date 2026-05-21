import type { WorkflowFile } from "@/lib/api"

export interface Port {
  /** Port id (used as React Flow handle id) */
  id: string
  /** Display label */
  label: string
}

export interface NodePorts {
  /** Input ports (left side) */
  inputs: Port[]
  /** Output ports (right side) */
  outputs: Port[]
}

/**
 * An identifier reference looks like: nodeId  or  nodeId.output.nested
 * Must start with a letter/underscore/$, followed by word chars/$.
 */
const REFERENCE = /^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*$/

/**
 * Derives input/output ports for each node from the workflow's actual data flow:
 *  - inputs come from the node's own `in:` block keys
 *  - outputs come from the FIRST path segment of any reference in OTHER nodes' `in:` blocks
 *    that points at this node
 */
export function derivePorts(workflow: WorkflowFile): Map<string, NodePorts> {
  const result = new Map<string, NodePorts>()

  // Initialise every node with empty ports
  for (const id of Object.keys(workflow.nodes)) {
    result.set(id, { inputs: [], outputs: [] })
  }

  // Pass 1 — inputs: keys of each node's own `in:` block
  for (const [nodeId, instance] of Object.entries(workflow.nodes)) {
    if (!instance.in) continue
    const np = result.get(nodeId)!
    const seen = new Set<string>()
    for (const fieldName of Object.keys(instance.in)) {
      if (seen.has(fieldName)) continue
      seen.add(fieldName)
      np.inputs.push({ id: fieldName, label: fieldName })
    }
  }

  // Pass 2 — outputs: walk every `in:` block, parse references, attribute
  // the first path segment to the SOURCE node's outputs list.
  for (const instance of Object.values(workflow.nodes)) {
    if (!instance.in) continue
    for (const value of Object.values(instance.in)) {
      if (typeof value !== "string") continue
      if (!REFERENCE.test(value)) continue
      const [sourceNodeId, ...rest] = value.split(".")
      if (!sourceNodeId) continue
      if (!workflow.nodes[sourceNodeId]) continue // unresolved reference — skip
      // First segment of the rest is the output port name; bare "nodeId" → "out"
      const portName = rest[0] ?? "out"
      const np = result.get(sourceNodeId)
      if (!np) continue
      // Deduplicate: only add each output port once
      if (np.outputs.some((p) => p.id === portName)) continue
      np.outputs.push({ id: portName, label: portName })
    }
  }

  return result
}
