import type { Assertion, AssertionOp } from "@darrylondil/lorien-runtime/requests"
import { parsePath } from "@darrylondil/lorien-runtime/requests"
import type { JsonSchema, NodeSchemas, WorkflowFile } from "@/lib/api"
import { isHttpResponse } from "@/workflow/core-nodes"
import { unwrapSchema } from "@/workflow/variables"

/**
 * The shapes a check can point into, so the checks editor can offer fields to
 * click instead of paths to type: the response body (from the schemas of the
 * nodes that feed each Response, plus the last response itself), the headers
 * seen, and every node's input and output.
 */
export interface CheckShapes {
  body: JsonSchema | undefined
  headers: string[]
  nodes: Array<{ id: string; input: JsonSchema | undefined; output: JsonSchema | undefined }>
}

/** A path segment: a field name, or an array index. */
export type Segment = string | number

const IDENT = /^[A-Za-z_$][\w$-]*$/

/** `["pets", 0, "name"]` → `pets[0].name`; odd keys are quoted. */
export function formatPath(segments: Segment[]): string {
  let out = ""
  for (const s of segments) {
    if (typeof s === "number") out += `[${s}]`
    else if (IDENT.test(s)) out += out === "" ? s : `.${s}`
    else out += `[${JSON.stringify(s)}]`
  }
  return out
}

/** `pets[0].name` → `["pets", 0, "name"]`; null when it doesn't parse. */
export function splitPath(path: string | undefined): Segment[] | null {
  if (!path) return []
  const raw = parsePath(path)
  if (!raw) return null
  // Only bracketed digits are indexes: `a[0]` is an index, `a.0` stays a key.
  const indexes = new Set<number>()
  let n = 0
  for (const m of path.matchAll(/\[\s*(\d+)\s*\]|\[[^\]]*\]|[^.[\]]+/g)) {
    if (m[1] !== undefined) indexes.add(n)
    n++
  }
  return raw.map((s, i) => (indexes.has(i) ? Number(s) : s))
}

/** The schema of a value, guessed from the value itself. */
export function schemaFromValue(value: unknown, depth = 0): JsonSchema | undefined {
  if (value === undefined) return undefined
  if (value === null) return { type: "null" }
  if (Array.isArray(value)) {
    const items =
      depth < 6
        ? mergeSchemas(value.slice(0, 5).map((v) => schemaFromValue(v, depth + 1)))
        : undefined
    return items ? { type: "array", items } : { type: "array" }
  }
  if (typeof value === "object") {
    if (depth >= 6) return { type: "object" }
    const properties: Record<string, JsonSchema> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      properties[k] = schemaFromValue(v, depth + 1) ?? {}
    }
    return { type: "object", properties }
  }
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" }
  return { type: typeof value }
}

/**
 * One schema covering several: object fields are unioned, and the first
 * schema that says something wins for everything else.
 */
export function mergeSchemas(list: Array<JsonSchema | undefined>): JsonSchema | undefined {
  const all = list
    .map(unwrapSchema)
    .filter((s): s is JsonSchema => !!s && Object.keys(s).length > 0)
  if (all.length === 0) return undefined
  if (all.length === 1) return all[0]
  const objects = all.filter((s) => s.type === "object" || s.properties)
  if (objects.length > 0 && objects.length === all.length) {
    const keys = new Set(objects.flatMap((s) => Object.keys(s.properties ?? {})))
    if (keys.size === 0) return objects[0]
    const properties: Record<string, JsonSchema> = {}
    for (const k of keys) {
      properties[k] = mergeSchemas(objects.map((s) => s.properties?.[k])) ?? {}
    }
    return { type: "object", properties }
  }
  const arrays = all.filter((s) => s.type === "array")
  if (arrays.length === all.length) {
    const items = mergeSchemas(arrays.map((s) => s.items))
    return items ? { type: "array", items } : { type: "array" }
  }
  return all[0]
}

/** Variants of `anyOf` / `oneOf` merged so their fields can be browsed together. */
function flatten(schema: JsonSchema | undefined): JsonSchema | undefined {
  const s = unwrapSchema(schema)
  if (!s) return s
  const variants = (s.anyOf ?? s.oneOf) as JsonSchema[] | undefined
  if (Array.isArray(variants) && !s.type) {
    return mergeSchemas(variants.filter((v) => v?.type !== "null"))
  }
  return s
}

/** The fields under a schema: an object's properties, or an array's item. */
export function childrenOf(
  schema: JsonSchema | undefined,
): Array<{ key: Segment; schema: JsonSchema | undefined }> {
  const s = flatten(schema)
  if (!s) return []
  if (s.type === "array" || (s.items && !s.properties)) {
    return [{ key: 0, schema: s.items as JsonSchema | undefined }]
  }
  return Object.entries(s.properties ?? {}).map(([key, sub]) => ({ key, schema: sub }))
}

/** The schema at a path; undefined once the path leaves what the schema knows. */
export function schemaAt(
  schema: JsonSchema | undefined,
  segments: Segment[],
): JsonSchema | undefined {
  let cur = flatten(schema)
  for (const seg of segments) {
    if (!cur) return undefined
    if (typeof seg === "number" || cur.type === "array") {
      cur = flatten(cur.items as JsonSchema | undefined)
    } else {
      cur = flatten(cur.properties?.[seg])
    }
  }
  return cur
}

/** A short type name for a picker row: "string", "number", "enum", "array", "object". */
export function typeName(schema: JsonSchema | undefined): string {
  const s = flatten(schema)
  if (!s) return ""
  if (Array.isArray(s.enum)) return "enum"
  if (s.type === "integer") return "number"
  if (typeof s.type === "string") return s.type
  if (s.properties) return "object"
  return ""
}

/** The node an input is read from: `AddPet.pet.id` → the schema of AddPet's `pet.id`. */
export function refSchema(
  wf: WorkflowFile,
  schemas: Record<string, NodeSchemas>,
  ref: string,
): JsonSchema | undefined {
  const [nodeId, ...rest] = ref.split(".")
  const node = nodeId ? wf.nodes[nodeId] : undefined
  if (!node) return undefined
  const segments = splitPath(rest.join(".")) ?? []
  if (node.uses === "@core/variable") {
    return schemaAt(schemaFromValue(node.values?.value), segments)
  }
  return schemaAt(schemas[node.uses]?.outputs, segments)
}

/** What the workflow's Response nodes send as a body, as one schema. */
export function responseBodySchema(
  wf: WorkflowFile | null,
  schemas: Record<string, NodeSchemas>,
): JsonSchema | undefined {
  if (!wf) return undefined
  const bodies: Array<JsonSchema | undefined> = []
  for (const node of Object.values(wf.nodes)) {
    if (!isHttpResponse(node.uses)) continue
    const ref = typeof node.in === "string" ? undefined : node.in?.body
    if (ref) bodies.push(refSchema(wf, schemas, ref))
    else if (node.values?.body !== undefined) bodies.push(schemaFromValue(node.values.body))
  }
  return mergeSchemas(bodies)
}

/** Every node in the workflow with the shape of its input and output. */
export function nodeShapes(
  wf: WorkflowFile | null,
  schemas: Record<string, NodeSchemas>,
): CheckShapes["nodes"] {
  if (!wf) return []
  return Object.entries(wf.nodes).map(([id, node]) => ({
    id,
    input: schemas[node.uses]?.inputs,
    output:
      node.uses === "@core/variable"
        ? { type: "object", properties: { value: schemaFromValue(node.values?.value) ?? {} } }
        : schemas[node.uses]?.outputs,
  }))
}

const ALL_OPS: AssertionOp[] = [
  "equals",
  "notEquals",
  "contains",
  "matches",
  "lessThan",
  "greaterThan",
  "exists",
  "notExists",
  "type",
]

/** The comparisons that make sense for a value of this schema, most useful first. */
export function opsFor(schema: JsonSchema | undefined, current?: AssertionOp): AssertionOp[] {
  const t = typeName(schema)
  let ops: AssertionOp[]
  switch (t) {
    case "number":
      ops = ["equals", "notEquals", "lessThan", "greaterThan", "exists", "notExists", "type"]
      break
    case "string":
      ops = ["equals", "notEquals", "contains", "matches", "exists", "notExists", "type"]
      break
    case "enum":
    case "boolean":
      ops = ["equals", "notEquals", "exists", "notExists"]
      break
    case "array":
      ops = ["contains", "equals", "exists", "notExists", "type"]
      break
    case "object":
      ops = ["exists", "notExists", "equals", "contains", "type"]
      break
    default:
      ops = ALL_OPS
  }
  return current && !ops.includes(current) ? [...ops, current] : ops
}

/** The schema a check's value is compared against, when the shapes know it. */
export function subjectSchema(a: Assertion, shapes: CheckShapes): JsonSchema | undefined {
  switch (a.target) {
    case "status":
    case "duration":
      return { type: "integer" }
    case "header":
      return { type: "string" }
    case "body":
      return schemaAt(shapes.body, splitPath(a.path) ?? [])
    case "node": {
      const node = shapes.nodes.find((n) => n.id === a.node)
      const [root, ...rest] = splitPath(a.path) ?? []
      if (!node || root === undefined) return undefined
      if (root === "error") return { type: "string" }
      if (root === "input") return schemaAt(node.input, rest)
      if (root === "output") return schemaAt(node.output, rest)
      return undefined
    }
  }
}
