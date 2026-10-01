import type { JsonSchema, NodeSchemas, WorkflowFile } from "@/lib/api"
import { uniqueId } from "./add-node"

/**
 * Variables are `@core/variable` nodes: a named constant kept under
 * `values: { value }` that other nodes read as `<id>.value`. The IDE types a
 * variable from the input it feeds, so it can offer the right editor.
 */
export const VARIABLE_USES = "@core/variable"
export const VARIABLE_PORT = "value"

export type VariableKind = "enum" | "boolean" | "number" | "string" | "json"

/** The types a variable can be given by hand, under `values.type`. */
export const VARIABLE_TYPES = ["string", "number", "boolean", "json"] as const
export type VariableType = (typeof VARIABLE_TYPES)[number]

/** The type picked for a variable, when one is. */
export function declaredType(
  values: Record<string, unknown> | undefined,
): VariableType | undefined {
  const t = values?.type
  return (VARIABLE_TYPES as readonly unknown[]).includes(t) ? (t as VariableType) : undefined
}

/** True when the input a variable feeds says what it holds, so there's no type to pick. */
export function typedByInput(schema: JsonSchema | undefined): boolean {
  const s = unwrapSchema(schema)
  return !!s && (Array.isArray(s.enum) || typeof s.type === "string")
}

/**
 * `value` carried over to another type: text keeps what it can (numbers and
 * JSON as their text, text that parses as JSON as that), anything else
 * starts empty.
 */
export function convertValue(value: unknown, to: VariableType): unknown {
  switch (to) {
    case "string":
      if (typeof value === "string") return value
      if (value === undefined || value === null) return ""
      return typeof value === "object" ? JSON.stringify(value) : String(value)
    case "number": {
      const n = typeof value === "number" ? value : Number(value)
      return typeof value !== "boolean" && value !== "" && Number.isFinite(n) ? n : 0
    }
    case "boolean":
      return value === true || value === "true"
    case "json":
      if (typeof value === "string") {
        try {
          return JSON.parse(value)
        } catch {
          return {}
        }
      }
      return value === undefined ? {} : value
  }
}

/**
 * Strips `anyOf: [T, { type: "null" }]` (zod's `.nullable()`) down to T,
 * marked `nullable: true`.
 */
export function unwrapSchema(schema: JsonSchema | undefined): JsonSchema | undefined {
  if (!schema) return schema
  const anyOf = schema.anyOf as JsonSchema[] | undefined
  if (Array.isArray(anyOf)) {
    const options = anyOf.filter((s) => s?.type !== "null")
    if (options.length === 1) {
      const { anyOf: _drop, ...rest } = schema
      const nullable = options.length < anyOf.length || schema.nullable === true
      return unwrapSchema({ ...rest, ...options[0], ...(nullable ? { nullable: true } : {}) })
    }
  }
  return schema
}

/** The schema of the input at `portId` ("" is the whole input, "a.b" is nested). */
export function schemaAtPath(
  schema: JsonSchema | undefined,
  portId: string,
): JsonSchema | undefined {
  let cur = unwrapSchema(schema)
  if (portId === "") return cur
  for (const key of portId.split(".")) {
    cur = unwrapSchema(cur?.properties?.[key])
    if (!cur) return undefined
  }
  return cur
}

/**
 * Which editor a variable gets: the input it feeds decides, then the type
 * picked for it, then the value's own type.
 */
export function variableKind(
  schema: JsonSchema | undefined,
  value: unknown,
  declared?: VariableType,
): VariableKind {
  if (declared && !typedByInput(schema)) return declared
  const s = unwrapSchema(schema)
  if (s && Array.isArray(s.enum)) return "enum"
  const type = s?.type
  if (type === "boolean") return "boolean"
  if (type === "number" || type === "integer") return "number"
  if (type === "string") return "string"
  if (type !== undefined) return "json"
  if (typeof value === "boolean") return "boolean"
  if (typeof value === "number") return "number"
  if (typeof value === "string") return "string"
  return "json"
}

/** The short type name in a variable's header. */
export function typeLabel(
  schema: JsonSchema | undefined,
  value: unknown,
  declared?: VariableType,
): string {
  if (declared && !typedByInput(schema)) return declared
  const s = unwrapSchema(schema)
  if (s && Array.isArray(s.enum)) return "enum"
  if (typeof s?.type === "string") return s.type
  if (Array.isArray(value)) return "array"
  if (value === null) return "json"
  return typeof value === "object" ? "object" : typeof value
}

/** How a variable for this input will look, shown while its handle is dragged out. */
export function describeVariable(schema: JsonSchema | undefined): string {
  const s = unwrapSchema(schema)
  if (s && Array.isArray(s.enum)) {
    return `Select · ${s.enum.length} ${s.enum.length === 1 ? "option" : "options"}`
  }
  switch (s?.type) {
    case "boolean":
      return "Toggle"
    case "number":
    case "integer":
      return "Number"
    case "string":
      return "Text"
    case "array":
      return "List"
    case "object": {
      const n = Object.keys(s.properties ?? {}).length
      return n > 0 ? `Object · ${n} ${n === 1 ? "field" : "fields"}` : "Object"
    }
    default:
      return "JSON"
  }
}

/** Levels of a nested object laid out in a new variable; deeper objects start as {}. */
const SCAFFOLD_DEPTH = 2

/**
 * A starting value for a schema: its default when it has one, otherwise an
 * empty value of the right type. Objects are laid out two levels deep.
 */
export function scaffoldValue(schema: JsonSchema | undefined, level = 1): unknown {
  const s = unwrapSchema(schema)
  if (!s) return null
  if (s.default !== undefined) return structuredClone(s.default)
  if (s.const !== undefined) return s.const
  if (Array.isArray(s.enum)) return s.enum[0] ?? null
  switch (s.type) {
    case "boolean":
      return false
    case "number":
    case "integer":
      return typeof s.minimum === "number" && s.minimum > 0 ? s.minimum : 0
    case "string":
      return ""
    case "null":
      return null
    case "array":
      return []
    case "object": {
      if (!s.properties || level > SCAFFOLD_DEPTH) return {}
      const out: Record<string, unknown> = {}
      for (const [key, sub] of Object.entries(s.properties)) {
        out[key] = scaffoldValue(sub, level + 1)
      }
      return out
    }
    default:
      return {}
  }
}

/**
 * The first reason `value` doesn't fit `schema`, or null when it does. Covers
 * what a variable's editor can get wrong: types, enums, ranges, required
 * fields, and the same for nested fields and list items.
 */
export function checkValue(schema: JsonSchema | undefined, value: unknown, at = ""): string | null {
  const s = unwrapSchema(schema)
  if (!s) return null
  const where = at === "" ? "" : `${at}: `
  if (value === null && (s.nullable === true || s.type === "null")) return null
  if (Array.isArray(s.enum)) {
    return s.enum.some((o) => o === value)
      ? null
      : `${where}must be one of ${s.enum.map((o) => JSON.stringify(o)).join(", ")}`
  }
  switch (s.type) {
    case "string":
      return typeof value === "string" ? null : `${where}must be a string`
    case "boolean":
      return typeof value === "boolean" ? null : `${where}must be true or false`
    case "number":
    case "integer": {
      if (typeof value !== "number" || Number.isNaN(value)) return `${where}must be a number`
      if (s.type === "integer" && !Number.isInteger(value)) return `${where}must be a whole number`
      if (typeof s.minimum === "number" && value < s.minimum)
        return `${where}must be at least ${s.minimum}`
      if (typeof s.maximum === "number" && value > s.maximum)
        return `${where}must be at most ${s.maximum}`
      return null
    }
    case "array": {
      if (!Array.isArray(value)) return `${where}must be a list`
      for (let i = 0; i < value.length; i++) {
        const problem = checkValue(s.items, value[i], `${at}[${i}]`)
        if (problem) return problem
      }
      return null
    }
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return `${where}must be an object`
      }
      const obj = value as Record<string, unknown>
      for (const key of (s.required as string[] | undefined) ?? []) {
        if (obj[key] === undefined) return `${at === "" ? key : `${at}.${key}`} is required`
      }
      for (const [key, v] of Object.entries(obj)) {
        const sub =
          s.properties?.[key] ??
          (typeof s.additionalProperties === "object" ? s.additionalProperties : undefined)
        const problem = checkValue(sub, v, at === "" ? key : `${at}.${key}`)
        if (problem) return problem
      }
      return null
    }
    default:
      return null
  }
}

export interface VariableTarget {
  nodeId: string
  /** The input it feeds: "" for the whole input, otherwise the field path. */
  portId: string
}

/** Every input that reads this variable, in workflow order. */
export function variableTargets(wf: WorkflowFile, varId: string): VariableTarget[] {
  const ref = `${varId}.${VARIABLE_PORT}`
  const out: VariableTarget[] = []
  for (const [nodeId, node] of Object.entries(wf.nodes)) {
    if (typeof node.in === "string") {
      if (node.in === ref) out.push({ nodeId, portId: "" })
      continue
    }
    for (const [portId, source] of Object.entries(node.in ?? {})) {
      if (source === ref) out.push({ nodeId, portId })
    }
  }
  return out
}

/** A variable's type: the schema of the first input it feeds. */
export function variableSchema(
  wf: WorkflowFile,
  schemas: Record<string, NodeSchemas>,
  varId: string,
): JsonSchema | undefined {
  for (const t of variableTargets(wf, varId)) {
    const uses = wf.nodes[t.nodeId]?.uses
    const schema = uses ? schemaAtPath(schemas[uses]?.inputs, t.portId) : undefined
    if (schema) return schema
  }
  return undefined
}

/** A variable id from an input's name: "address.city" → "city", "max-items" → "max_items". */
export function variableIdFor(portId: string, target: string): string {
  const last = portId === "" ? `${target}Input` : (portId.split(".").pop() ?? "value")
  const ident = last.replace(/[^\w$]/g, "_")
  return /^[a-zA-Z_$]/.test(ident) ? ident : `v${ident}`
}

/**
 * Pulls an input out into a new variable: adds the variable at `position`,
 * seeded with the input's current literal (or a value scaffolded from its
 * schema), and wires the input to it. One edit, so one undo step.
 */
export function extractVariable(
  wf: WorkflowFile,
  opts: {
    target: string
    portId: string
    schema: JsonSchema | undefined
    position: { x: number; y: number }
  },
): { workflow: WorkflowFile; id: string } | null {
  const node = wf.nodes[opts.target]
  if (!node) return null
  const id = uniqueId(variableIdFor(opts.portId, opts.target), new Set(Object.keys(wf.nodes)))
  const ref = `${id}.${VARIABLE_PORT}`
  const literal = opts.portId === "" ? undefined : node.values?.[opts.portId]
  const value = literal !== undefined ? literal : scaffoldValue(opts.schema)

  const consumer = { ...node }
  if (opts.portId === "") {
    consumer.in = ref
    delete consumer.values
  } else {
    const base = typeof node.in === "string" || !node.in ? {} : { ...node.in }
    base[opts.portId] = ref
    consumer.in = base
    if (node.values && opts.portId in node.values) {
      const { [opts.portId]: _taken, ...rest } = node.values
      if (Object.keys(rest).length > 0) consumer.values = rest
      else delete consumer.values
    }
  }

  return {
    id,
    workflow: {
      ...wf,
      nodes: {
        ...wf.nodes,
        [id]: { uses: VARIABLE_USES, values: { [VARIABLE_PORT]: value } },
        [opts.target]: consumer,
      },
      view: { ...(wf.view ?? {}), [id]: opts.position },
    },
  }
}
