import type { JsonSchema } from "@/lib/api"

/**
 * Generate a sample JS value from a JsonSchema. Used to pre-fill request
 * bodies / query / headers from inferred schemas. Returns `null` for
 * malformed or unrecognized schemas.
 *
 * Precedence: default → enum[0] → type-based default.
 *  - string → ""
 *  - number/integer → 0
 *  - boolean → false
 *  - array → [] (no item synthesis in v1)
 *  - object → recursive fill of properties (empty if no properties)
 *  - unknown / missing type → null
 */
export function sampleFromSchema(schema: JsonSchema | null | undefined): unknown {
  if (!schema) return null
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  switch (schema.type) {
    case "string":
      return ""
    case "number":
    case "integer":
      return 0
    case "boolean":
      return false
    case "array":
      return []
    case "object": {
      const out: Record<string, unknown> = {}
      if (schema.properties) {
        for (const [k, sub] of Object.entries(schema.properties)) {
          out[k] = sampleFromSchema(sub)
        }
      }
      return out
    }
    default:
      return null
  }
}
