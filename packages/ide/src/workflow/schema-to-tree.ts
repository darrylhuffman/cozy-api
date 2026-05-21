import type { JsonSchema } from "@/lib/api"

export interface PortNode {
  /** Dotted path from root, used as the React Flow handle id (e.g., "user.email"). */
  id: string
  /** Display label (last segment only). */
  label: string
  /** If non-empty, this is an expandable branch. */
  children: PortNode[]
  /** True if this represents a leaf (scalar / unknown / array). */
  isLeaf: boolean
}

/**
 * Walks a JSON Schema and builds a port tree. For each `type: "object"` with
 * `properties`, returns a branch node with children; everything else is a leaf.
 */
export function schemaToTree(schema: JsonSchema | undefined, parentPath = ""): PortNode[] {
  if (!schema || schema.type !== "object" || !schema.properties) return []
  const out: PortNode[] = []
  for (const [key, sub] of Object.entries(schema.properties)) {
    const id = parentPath ? `${parentPath}.${key}` : key
    const isObject = sub?.type === "object" && Boolean(sub.properties)
    const children = isObject ? schemaToTree(sub, id) : []
    out.push({
      id,
      label: key,
      children,
      isLeaf: !isObject,
    })
  }
  return out
}

/**
 * Wraps the schema's top-level properties in a synthetic *root* PortNode whose
 * id is "" (empty path) and label is `rootLabel` (default: "input"). Used for
 * the input side of a node, where a single root port represents the whole
 * input object and its children are the individual schema fields.
 *
 * The root is rendered as a branch when the schema has properties; otherwise
 * it collapses to a single leaf (id = "").
 */
export function schemaToRootedTree(
  schema: JsonSchema | undefined,
  rootLabel = "input",
): PortNode {
  const children = schemaToTree(schema)
  return {
    id: "",
    label: rootLabel,
    children,
    isLeaf: children.length === 0,
  }
}
