import type { JsonSchema, NodeInstance, NodeSchemas, WorkflowFile } from "@/lib/api"
import { uniqueId } from "./add-node"

/**
 * Sub-workflows are `.workflow` files under `nodes/` that other workflows use
 * like a node (`uses: "./nodes/orders/reserve-seats"`). One starts at an
 * `@core/input` node, whose `values.fields` (name → type) are its inputs, and
 * ends at an `@core/output` node, whose `in` keys are its outputs.
 */
export const SUBWORKFLOW_INPUT = "@core/input"
export const SUBWORKFLOW_OUTPUT = "@core/output"

/** The type names an Input field can pick; anything else is a JSON Schema. */
export const FIELD_TYPES = ["string", "number", "boolean", "json"] as const
export type FieldType = (typeof FIELD_TYPES)[number]

/** True for "nodes/orders/reserve-seats.workflow". */
export function isSubworkflowPath(path: string | undefined): boolean {
  return !!path && path.startsWith("nodes/") && path.endsWith(".workflow")
}

/** "nodes/orders/reserve-seats.workflow" → "./nodes/orders/reserve-seats" */
export function subworkflowUses(path: string): string {
  return `./${path.replace(/\.workflow$/, "")}`
}

/** The file of a sub-workflow node, or null when `uses` isn't one. */
export function subworkflowPathOf(
  uses: string,
  schemas: Record<string, NodeSchemas>,
): string | null {
  return schemas[uses]?.subworkflow?.path ?? null
}

/** A starting sub-workflow: an Input and an Output with nothing between them. */
export function subworkflowSeed(): string {
  const file: WorkflowFile = {
    lorien: 1,
    nodes: {
      Input: { uses: SUBWORKFLOW_INPUT, values: { fields: {} } },
      Output: { uses: SUBWORKFLOW_OUTPUT },
    },
    view: { Input: { x: 0, y: 0 }, Output: { x: 560, y: 0 } },
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

/** An Input node's fields, name → type, in file order. */
export function inputFields(inst: NodeInstance | undefined): Record<string, unknown> {
  const fields = inst?.values?.fields
  return fields && typeof fields === "object" && !Array.isArray(fields)
    ? (fields as Record<string, unknown>)
    : {}
}

/** The schema of an Input field's type: a type name ("string") or a JSON Schema. */
export function fieldSchema(type: unknown): JsonSchema {
  if (type && typeof type === "object" && !Array.isArray(type)) return type as JsonSchema
  if (type === "json") return { type: "object" }
  return typeof type === "string" && type !== "" ? { type } : {}
}

/** The picker's value for a field's type; null when it's a JSON Schema the picker can't show. */
export function fieldTypeName(type: unknown): FieldType | null {
  return (FIELD_TYPES as readonly string[]).includes(type as string) ? (type as FieldType) : null
}

/** The names of an Output node's outputs, in file order. */
export function outputNames(inst: NodeInstance | undefined): string[] {
  return inst?.in && typeof inst.in === "object" ? Object.keys(inst.in) : []
}

/** Port names have to work as the first segment of a reference path. */
export function invalidPortName(name: string): string | null {
  if (!name) return "Enter a name"
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return "Use letters, numbers and underscores"
  return null
}

function withNode(wf: WorkflowFile, id: string, node: NodeInstance): WorkflowFile {
  return { ...wf, nodes: { ...wf.nodes, [id]: node } }
}

function withFields(wf: WorkflowFile, id: string, fields: Record<string, unknown>): WorkflowFile {
  const node = wf.nodes[id]
  if (!node) return wf
  return withNode(wf, id, { ...node, values: { ...(node.values ?? {}), fields } })
}

/** Renames `key` in place, so the file keeps its order. */
function renameKey<T>(obj: Record<string, T>, from: string, to: string): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === from ? to : k, v]))
}

/** Rewrites every reference (`in`, `when`) whose path starts with `from` to start with `to`. */
function rewriteRefs(wf: WorkflowFile, from: string, to: string): WorkflowFile {
  const fix = (ref: string) => {
    const neg = ref.startsWith("!")
    const bare = neg ? ref.slice(1) : ref
    const next = bare === from || bare.startsWith(`${from}.`) ? to + bare.slice(from.length) : bare
    return neg ? `!${next}` : next
  }
  const nodes: Record<string, NodeInstance> = {}
  for (const [id, node] of Object.entries(wf.nodes)) {
    let next = node
    if (typeof node.in === "string") next = { ...next, in: fix(node.in) }
    else if (node.in) {
      next = {
        ...next,
        in: Object.fromEntries(Object.entries(node.in).map(([k, v]) => [k, fix(v)])),
      }
    }
    if (node.when) next = { ...next, when: fix(node.when) }
    nodes[id] = next
  }
  return { ...wf, nodes }
}

/** Adds an input named `input` (or `input2`, …) of type string. */
export function addInputField(
  wf: WorkflowFile,
  id: string,
): { workflow: WorkflowFile; name: string } {
  const fields = inputFields(wf.nodes[id])
  const name = uniqueId("input", new Set(Object.keys(fields)))
  return { workflow: withFields(wf, id, { ...fields, [name]: "string" }), name }
}

export function setInputFieldType(
  wf: WorkflowFile,
  id: string,
  name: string,
  type: FieldType,
): WorkflowFile {
  const fields = inputFields(wf.nodes[id])
  if (!(name in fields)) return wf
  return withFields(wf, id, { ...fields, [name]: type })
}

/**
 * Renames an input and every read of it inside the sub-workflow
 * (`Input.old…` → `Input.new…`). Returns null when the name is invalid or taken.
 */
export function renameInputField(
  wf: WorkflowFile,
  id: string,
  from: string,
  to: string,
): WorkflowFile | null {
  const fields = inputFields(wf.nodes[id])
  if (from === to) return wf
  if (!(from in fields) || to in fields || invalidPortName(to)) return null
  return rewriteRefs(
    withFields(wf, id, renameKey(fields, from, to)),
    `${id}.${from}`,
    `${id}.${to}`,
  )
}

export function removeInputField(wf: WorkflowFile, id: string, name: string): WorkflowFile {
  const { [name]: _gone, ...rest } = inputFields(wf.nodes[id])
  return withFields(wf, id, rest)
}

/**
 * Wires `ref` into the Output as a new output, named after the last segment
 * of the reference (`FindEvent.event` → `event`, or `event2` if taken).
 */
export function addOutput(
  wf: WorkflowFile,
  id: string,
  ref: string,
): { workflow: WorkflowFile; name: string } | null {
  const node = wf.nodes[id]
  if (!node) return null
  const current = typeof node.in === "object" && node.in ? node.in : {}
  const segments = ref.split(".")
  const last = segments.length > 1 ? segments[segments.length - 1] : `${segments[0]}Value`
  const base = invalidPortName(last ?? "") ? "value" : (last as string)
  const name = uniqueId(base, new Set(Object.keys(current)))
  return { workflow: withNode(wf, id, { ...node, in: { ...current, [name]: ref } }), name }
}

/** Renames an output. Returns null when the name is invalid or taken. */
export function renameOutput(
  wf: WorkflowFile,
  id: string,
  from: string,
  to: string,
): WorkflowFile | null {
  const node = wf.nodes[id]
  if (!node || typeof node.in !== "object" || !node.in || !(from in node.in)) return null
  if (from === to) return wf
  if (to in node.in || invalidPortName(to)) return null
  return withNode(wf, id, { ...node, in: renameKey(node.in, from, to) })
}

export function removeOutput(wf: WorkflowFile, id: string, name: string): WorkflowFile {
  const node = wf.nodes[id]
  if (!node || typeof node.in !== "object" || !node.in) return wf
  const { [name]: _gone, ...rest } = node.in
  const next: NodeInstance = { ...node, in: rest }
  if (Object.keys(rest).length === 0) delete next.in
  return withNode(wf, id, next)
}
