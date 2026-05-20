import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types"
import type { OpenAPIObject } from "./load-spec.js"
import { resolveRef } from "./resolve-ref.js"

type SchemaOrRef =
  | OpenAPIV3.SchemaObject
  | OpenAPIV3.ReferenceObject
  | OpenAPIV3_1.SchemaObject
  | OpenAPIV3_1.ReferenceObject

export interface ConvertContext {
  /** Track $ref to avoid infinite recursion on cyclic schemas. */
  refStack: Set<string>
  /** Warnings collected during conversion (e.g., unsupported features). */
  warnings: string[]
}

export function newContext(): ConvertContext {
  return { refStack: new Set(), warnings: [] }
}

/**
 * Converts an OpenAPI Schema Object (or ReferenceObject) to a Zod source string.
 * The returned string is valid TS code referencing `z` (the user must import zod).
 *
 * We emit STRINGS, not Zod instances — the output is embedded in generated .ts files.
 */
export function schemaToZod(
  schema: SchemaOrRef,
  spec: OpenAPIObject,
  ctx: ConvertContext = newContext(),
): string {
  // Handle $ref by resolving once, with cycle detection via ctx.refStack
  if ("$ref" in schema) {
    if (ctx.refStack.has(schema.$ref)) {
      ctx.warnings.push(`Cyclic ref ${schema.$ref} encountered; emitting z.unknown()`)
      return "z.unknown()"
    }
    const resolved = resolveRef(spec, schema.$ref)
    const nextCtx: ConvertContext = {
      warnings: ctx.warnings,
      refStack: new Set([...ctx.refStack, schema.$ref]),
    }
    return schemaToZod(resolved as SchemaOrRef, spec, nextCtx)
  }

  // Composition: not supported in v1.0
  if ("allOf" in schema || "oneOf" in schema || "anyOf" in schema) {
    ctx.warnings.push(`Composition (allOf/oneOf/anyOf) not supported; emitting z.unknown()`)
    return "z.unknown() /* TODO: composition not supported in v1.0 */"
  }

  const nullable = isNullable(schema)
  const baseExpr = convertByType(schema, spec, ctx)
  return nullable ? `${baseExpr}.nullable()` : baseExpr
}

function isNullable(schema: OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject): boolean {
  // OAS 3.0 uses `nullable: true`; OAS 3.1 uses `type: ['string', 'null']`
  if ("nullable" in schema && schema.nullable === true) return true
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true
  return false
}

function convertByType(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject,
  spec: OpenAPIObject,
  ctx: ConvertContext,
): string {
  // Normalize 3.1 array type like ["string", "null"] into single primary type
  let type: string | undefined
  if (Array.isArray(schema.type)) {
    type = schema.type.find((t) => t !== "null")
  } else {
    type = schema.type as string | undefined
  }

  if (type === "string") return convertString(schema)
  if (type === "integer") return convertInteger(schema)
  if (type === "number") return convertNumber(schema)
  if (type === "boolean") return "z.boolean()"
  if (type === "array") return convertArray(schema, spec, ctx)
  if (type === "object") return convertObject(schema, spec, ctx)

  ctx.warnings.push(`Unknown or missing type "${type ?? "(none)"}"; emitting z.unknown()`)
  return "z.unknown()"
}

function convertString(schema: OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject): string {
  if (schema.enum && Array.isArray(schema.enum)) {
    const values = schema.enum.map((v) => JSON.stringify(v)).join(", ")
    return `z.enum([${values}] as const)`
  }

  let expr = "z.string()"
  const format = (schema as { format?: string }).format
  if (format === "email") expr += ".email()"
  else if (format === "uuid") expr += ".uuid()"
  else if (format === "date-time") expr += ".datetime()"
  else if (format === "date") expr += ".date()"
  else if (format === "uri" || format === "url") expr += ".url()"

  if (typeof schema.minLength === "number") expr += `.min(${schema.minLength})`
  if (typeof schema.maxLength === "number") expr += `.max(${schema.maxLength})`
  return expr
}

function convertInteger(schema: OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject): string {
  let expr = "z.number().int()"
  if (typeof schema.minimum === "number") expr += `.min(${schema.minimum})`
  if (typeof schema.maximum === "number") expr += `.max(${schema.maximum})`
  return expr
}

function convertNumber(schema: OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject): string {
  let expr = "z.number()"
  if (typeof schema.minimum === "number") expr += `.min(${schema.minimum})`
  if (typeof schema.maximum === "number") expr += `.max(${schema.maximum})`
  return expr
}

function convertArray(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject,
  spec: OpenAPIObject,
  ctx: ConvertContext,
): string {
  const items = (schema as { items?: SchemaOrRef }).items
  if (!items) return "z.array(z.unknown())"
  return `z.array(${schemaToZod(items, spec, ctx)})`
}

function convertObject(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject,
  spec: OpenAPIObject,
  ctx: ConvertContext,
): string {
  const props = (schema as { properties?: Record<string, SchemaOrRef> }).properties
  if (!props || Object.keys(props).length === 0) {
    return "z.record(z.string(), z.unknown())"
  }

  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
  const entries: string[] = []
  for (const [key, propSchema] of Object.entries(props)) {
    let valueExpr = schemaToZod(propSchema, spec, ctx)
    if (!required.has(key)) valueExpr += ".optional()"
    entries.push(`${JSON.stringify(key)}: ${valueExpr}`)
  }
  return `z.object({ ${entries.join(", ")} })`
}
