import type { NodeInstance, NodeSchemas, WorkflowFile } from "@/lib/api"
import { type PortNode, schemaToRootedTree, schemaToTree } from "./schema-to-tree"

export type { PortNode } from "./schema-to-tree"

export interface NodePorts {
  /**
   * Single root input port representing the WHOLE input object. Its `id` is ""
   * (empty path); its children are the schema's top-level fields. Connecting
   * to the root sets `in: "ref"` (string form); connecting to a child sets
   * the per-field form `in: { fieldName: "ref" }`.
   */
  inputs: PortNode
  /** Output ports (right side) — array of top-level schema properties */
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

  const emptyRoot = (): PortNode => ({ id: "", label: "input", children: [], isLeaf: true })

  for (const id of Object.keys(workflow.nodes)) {
    result.set(id, { inputs: emptyRoot(), outputs: [] })
  }

  // Inputs: a single ROOT port whose children are derived from the schema.
  // Fallback (no schema): derive children from the keys of an object-form `in:`,
  // matching the legacy behaviour for older workflow files.
  for (const [nodeId, instance] of Object.entries(workflow.nodes)) {
    const np = result.get(nodeId)!
    const schemaInputs = schemas[instance.uses]?.inputs
    const fromSchema = schemaToTree(schemaInputs)
    if (fromSchema.length > 0) {
      np.inputs = {
        id: "",
        label: "input",
        children: fromSchema,
        isLeaf: false,
      }
      continue
    }
    // Fall back to keys of object-form `in:` — string form has no per-field
    // children to infer (the input IS the resolved value).
    if (!instance.in || typeof instance.in === "string") continue
    const children: PortNode[] = []
    const seen = new Set<string>()
    for (const fieldName of Object.keys(instance.in)) {
      if (seen.has(fieldName)) continue
      seen.add(fieldName)
      children.push({ id: fieldName, label: fieldName, children: [], isLeaf: true })
    }
    if (children.length > 0) {
      np.inputs = { id: "", label: "input", children, isLeaf: false }
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
    // Both forms can produce reference strings — collect them uniformly.
    const refValues: unknown[] =
      typeof instance.in === "string" ? [instance.in] : Object.values(instance.in)
    for (const value of refValues) {
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

  // Apply hard-coded per-node conditional port filtering.
  // Currently only @core/http-request has conditional ports (body hidden for GET/DELETE).
  for (const [nodeId, instance] of Object.entries(workflow.nodes)) {
    if (instance.uses !== "@core/http-request") continue
    const np = result.get(nodeId)
    if (!np) continue
    result.set(nodeId, applyHttpRequestConditional(np, instance))
  }

  return result
}

/**
 * Hard-coded conditional port filtering for @core/http-request.
 *
 * When method is GET or DELETE, the `body` input port is hidden — those HTTP
 * methods conventionally have no request body. The method is read from
 * instance.in (literal) first, then instance.config (back-compat).
 *
 * The general Zod-discriminated-union / JSON Schema `if/then/else` case is a
 * larger feature — deferred. This hard-codes only the http-request case.
 */
function applyHttpRequestConditional(ports: NodePorts, instance: NodeInstance): NodePorts {
  const inObj =
    typeof instance.in === "object" && instance.in !== null ? instance.in : {}
  const config = (instance.config ?? {}) as Record<string, unknown>
  const method = ((inObj as Record<string, unknown>).method ?? config.method) as string | undefined

  if (method !== "GET" && method !== "DELETE") return ports
  if (!ports.inputs.children || ports.inputs.children.length === 0) return ports

  return {
    ...ports,
    inputs: {
      ...ports.inputs,
      children: ports.inputs.children.filter((c) => c.id !== "body"),
    },
  }
}

/**
 * Internal helper kept around for schemaToRootedTree consumers. Not currently
 * used elsewhere — derivePorts inlines the equivalent logic so it can fall
 * back to inferring children from `in:` keys when no schema is present.
 */
export { schemaToRootedTree }
