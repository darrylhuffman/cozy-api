import type { JsonSchema, NodeSchemas, WorkflowFile } from "@/lib/api"

export interface ConsumedShapes {
  body: JsonSchema | null
  query: JsonSchema | null
  headers: JsonSchema | null
}

type Category = "body" | "query" | "headers"
const CATEGORIES: Category[] = ["body", "query", "headers"]

/**
 * Walks the workflow's nodes and finds `in:` references that read from the
 * trigger's outputs (body / query / headers). For each, resolves the consumer
 * node's input schema and synthesizes an object schema describing what the
 * trigger output must contain.
 *
 * Reference shapes handled:
 *   - per-field:    in: { email: "TriggerId.body.email" }
 *                   contributes { properties.email: SaveUser.inputs.properties.email }
 *   - whole-object: in: "TriggerId.body"
 *                   contributes the consumer's full inputs schema (replaces any prior)
 *
 * Deeper paths ("TriggerId.body.user.email") are skipped — v1 only matches
 * depth-3 per-field refs. Multiple consumers merge properties; on key
 * conflict the first writer wins.
 *
 * The `params` output isn't inferred — params come from URL path matching,
 * not pre-fillable from schema alone.
 */
export function discoverTriggerConsumers(
  workflow: WorkflowFile,
  triggerNodeId: string,
  schemas: Record<string, NodeSchemas>,
): ConsumedShapes {
  const acc: Record<Category, Record<string, JsonSchema>> = {
    body: {},
    query: {},
    headers: {},
  }
  const wholeObject: Partial<Record<Category, JsonSchema>> = {}

  for (const [nodeId, instance] of Object.entries(workflow.nodes)) {
    if (nodeId === triggerNodeId) continue
    const consumerSchema = schemas[instance.uses]
    if (!consumerSchema) continue

    if (typeof instance.in === "string") {
      const parts = instance.in.split(".")
      if (parts.length === 2 && parts[0] === triggerNodeId) {
        const cat = parts[1] as Category
        if (CATEGORIES.includes(cat)) {
          if (
            Object.keys(acc[cat]).length === 0 &&
            wholeObject[cat] === undefined
          ) {
            wholeObject[cat] = consumerSchema.inputs
          }
        }
      }
      continue
    }

    if (instance.in && typeof instance.in === "object") {
      for (const [field, ref] of Object.entries(instance.in)) {
        if (typeof ref !== "string") continue
        const parts = ref.split(".")
        if (parts.length !== 3) continue
        if (parts[0] !== triggerNodeId) continue
        const cat = parts[1] as Category
        if (!CATEGORIES.includes(cat)) continue
        const path = parts[2]!
        const fieldSchema = consumerSchema.inputs?.properties?.[field]
        if (!fieldSchema) continue
        if (acc[cat][path] === undefined) {
          acc[cat][path] = fieldSchema
        }
      }
    }
  }

  const toShape = (cat: Category): JsonSchema | null => {
    if (Object.keys(acc[cat]).length > 0) {
      return { type: "object", properties: acc[cat] }
    }
    if (wholeObject[cat]) return wholeObject[cat]!
    return null
  }

  return {
    body: toShape("body"),
    query: toShape("query"),
    headers: toShape("headers"),
  }
}
