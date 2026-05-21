import type { NodeSchemas, WorkflowFile } from "@/lib/api"
import { type PortNode, schemaToTree } from "./schema-to-tree"

export type { PortNode } from "./schema-to-tree"

export interface NodePorts {
  /** Input ports (left side) */
  inputs: PortNode[]
  /** Output ports (right side) */
  outputs: PortNode[]
}

/**
 * An identifier reference looks like: nodeId  or  nodeId.output.nested
 * Must start with a letter/underscore/$, followed by word chars/$.
 */
const REFERENCE = /^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*$/

/**
 * Derives input/output ports for each node.
 *
 * Schema is the source of truth when available:
 *  - inputs  = schemaToTree(schemas[uses].inputs)  fallback: keys of `in:` block
 *  - outputs = schemaToTree(schemas[uses].outputs) fallback: ports inferred from
 *              other nodes' references to this one (legacy behaviour)
 */
export function derivePorts(
  workflow: WorkflowFile,
  schemas: Record<string, NodeSchemas> = {},
): Map<string, NodePorts> {
  const result = new Map<string, NodePorts>()

  for (const id of Object.keys(workflow.nodes)) {
    result.set(id, { inputs: [], outputs: [] })
  }

  // Inputs: prefer the schema; fall back to keys of `in:`
  for (const [nodeId, instance] of Object.entries(workflow.nodes)) {
    const np = result.get(nodeId)!
    const schemaInputs = schemas[instance.uses]?.inputs
    const fromSchema = schemaToTree(schemaInputs)
    if (fromSchema.length > 0) {
      np.inputs = fromSchema
      continue
    }
    // Fall back to keys of `in:`
    if (!instance.in) continue
    const seen = new Set<string>()
    for (const fieldName of Object.keys(instance.in)) {
      if (seen.has(fieldName)) continue
      seen.add(fieldName)
      np.inputs.push({ id: fieldName, label: fieldName, children: [], isLeaf: true })
    }
  }

  // Outputs: prefer the schema; fall back to inference from references in other nodes
  for (const [nodeId, instance] of Object.entries(workflow.nodes)) {
    const np = result.get(nodeId)!
    const schemaOutputs = schemas[instance.uses]?.outputs
    const fromSchema = schemaToTree(schemaOutputs)
    if (fromSchema.length > 0) {
      np.outputs = fromSchema
    }
  }

  // For nodes without schema-derived outputs, fall back to legacy inference.
  // Pass through all `in:` blocks: any string reference creates an output port
  // (top-level only) on the source node. We snapshot which nodes already have
  // schema-derived outputs BEFORE adding anything, so we don't skip nodes
  // mid-loop.
  const nodesWithSchemaOutputs = new Set<string>()
  for (const [nodeId, np] of result.entries()) {
    if (np.outputs.length > 0) nodesWithSchemaOutputs.add(nodeId)
  }
  for (const instance of Object.values(workflow.nodes)) {
    if (!instance.in) continue
    for (const value of Object.values(instance.in)) {
      if (typeof value !== "string") continue
      if (!REFERENCE.test(value)) continue
      const [sourceNodeId, ...rest] = value.split(".")
      if (!sourceNodeId) continue
      if (!workflow.nodes[sourceNodeId]) continue
      if (nodesWithSchemaOutputs.has(sourceNodeId)) continue
      const np = result.get(sourceNodeId)
      if (!np) continue
      const portName = rest[0] ?? "out"
      if (np.outputs.some((p) => p.id === portName)) continue
      np.outputs.push({ id: portName, label: portName, children: [], isLeaf: true })
    }
  }

  return result
}
