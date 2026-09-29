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
  // Fallback (no schema): derive children from the keys of object-form `in:`
  // AND `values:`. String-form `in:` has no per-field children to infer (the
  // input IS the resolved value).
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
    const children: PortNode[] = []
    const seen = new Set<string>()
    const collectKeys = (obj: Record<string, unknown> | undefined): void => {
      if (!obj) return
      for (const fieldName of Object.keys(obj)) {
        if (seen.has(fieldName)) continue
        seen.add(fieldName)
        children.push({ id: fieldName, label: fieldName, children: [], isLeaf: true })
      }
    }
    if (instance.in && typeof instance.in !== "string") {
      collectKeys(instance.in as Record<string, unknown>)
    }
    collectKeys(instance.values)
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
      np.outputs.push({
        id: portName,
        label: portName,
        children: [],
        isLeaf: true,
        inferred: true,
      })
    }
  }

  // Nested inference: when a reference reaches into an opaque output (e.g.
  // `request.body.email` where `body` is a leaf of unknown shape), grow the
  // tree so the leaf becomes a branch with inferred children matching the
  // reference path. This keeps edge rendering anchored to real handles —
  // `effectiveHandle("body.email", ...)` now has a real "body.email" to walk
  // up to — and makes the structure discoverable when the user expands `body`.
  //
  // Rules:
  //  - Top-level segments are NOT added here; the legacy pass above respects
  //    schema authority by not introducing new top-level ports for
  //    schema-derived nodes. Nested grafting starts from an EXISTING port.
  //  - A leaf is only promoted to a branch when it is "safe to grow": no
  //    schema, or schema describes an opaque object (`type: "object"` with no
  //    `properties`). Primitives are left alone.
  //  - Created or promoted ports carry `inferred: true` so the initial-
  //    expansion logic can keep them collapsed by default.
  for (const instance of Object.values(workflow.nodes)) {
    if (!instance.in) continue
    const refValues: unknown[] =
      typeof instance.in === "string" ? [instance.in] : Object.values(instance.in)
    for (const value of refValues) {
      if (typeof value !== "string") continue
      if (!REFERENCE.test(value)) continue
      const [sourceNodeId, ...rest] = value.split(".")
      if (!sourceNodeId) continue
      if (!workflow.nodes[sourceNodeId]) continue
      if (rest.length < 2) continue
      const np = result.get(sourceNodeId)
      if (!np) continue
      growNestedFromRef(np.outputs, rest)
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
 * `body` is an OUTPUT port — it represents the request body that the trigger
 * receives from the HTTP client. For GET and DELETE requests, there is no
 * request body by convention, so we hide it from the outputs tree.
 *
 * The method is read from instance.values.method (the user-typed literal).
 * References in `in.method` would resolve per-request and don't apply at
 * design time, so we don't read them here.
 *
 * The general Zod-discriminated-union / JSON Schema `if/then/else` case is a
 * larger feature — deferred. This hard-codes only the http-request case.
 */
function applyHttpRequestConditional(ports: NodePorts, instance: NodeInstance): NodePorts {
  const values = (instance.values ?? {}) as Record<string, unknown>
  const method = values.method as string | undefined

  if (method !== "GET" && method !== "DELETE") return ports

  // Filter `body` from OUTPUTS — body is a property of the incoming request
  // that the http-request trigger exposes. GET and DELETE have no request body.
  return {
    ...ports,
    outputs: ports.outputs.filter((p) => p.id !== "body"),
  }
}

/**
 * A leaf is safe to promote to a branch if it has no schema (purely inferred)
 * or its schema describes an opaque object (`type: "object"` without
 * `properties`). Primitives, arrays, and enums are left alone — a reference
 * that drills into them is a workflow bug, not a hint about structure.
 */
function isPromotableLeaf(port: PortNode): boolean {
  if (!port.isLeaf) return false
  if (!port.schema) return true
  return port.schema.type === "object"
}

/**
 * Walks `segments` into an output tree, promoting leaves to branches and
 * creating missing children as needed. Every port created or promoted by this
 * walk is marked `inferred: true`. Bails out silently if it hits a leaf that
 * is not safe to grow (e.g. a typed primitive).
 *
 * Top-level segments must already exist — this only grafts nested structure
 * onto ports the upstream passes (schema or legacy inference) have already
 * established.
 */
function growNestedFromRef(outputs: PortNode[], segments: string[]): void {
  if (segments.length < 2) return
  const [first, ...rest] = segments
  if (!first) return
  const topPort = outputs.find((p) => p.id === first)
  if (!topPort) return
  let port = topPort
  let pathPrefix = first
  for (let i = 0; i < rest.length; i++) {
    const seg = rest[i]!
    const fullPath = `${pathPrefix}.${seg}`
    const isLast = i === rest.length - 1
    if (port.isLeaf) {
      if (!isPromotableLeaf(port)) return
      port.isLeaf = false
      port.inferred = true
      port.children = []
      delete port.schema
    }
    let next = port.children.find((c) => c.id === fullPath)
    if (!next) {
      next = {
        id: fullPath,
        label: seg,
        children: [],
        isLeaf: true,
        inferred: true,
      }
      port.children.push(next)
    }
    if (isLast) return
    port = next
    pathPrefix = fullPath
  }
}

/**
 * Internal helper kept around for schemaToRootedTree consumers. Not currently
 * used elsewhere — derivePorts inlines the equivalent logic so it can fall
 * back to inferring children from `in:` keys when no schema is present.
 */
export { schemaToRootedTree }
