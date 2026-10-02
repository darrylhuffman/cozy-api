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
  /**
   * The JSON Schema for this port (leaf nodes only). Carried through so that
   * the workflow node can render the correct inline input widget (text, number,
   * select, checkbox) without re-fetching the schema.
   *
   * Only present when the port was derived from a schema property. Absent for
   * ports inferred from `in:` keys (no schema available).
   */
  schema?: JsonSchema | undefined
  /**
   * True when this port (or this port's branch structure) was synthesised from
   * references in the workflow rather than declared by a schema. Used by the
   * initial-expansion logic to keep inferred branches collapsed by default.
   */
  inferred?: boolean
  /** True when the parent schema lists this field in `required`. */
  required?: boolean
  /**
   * True for a logic node's branch output (a switch case, `default`, an
   * if's `true`/`false`): wired into another node, it sets that node's `when`.
   */
  branch?: boolean
  /**
   * For a logic node's `field` input: the type of the value it reads into,
   * so the card offers a picker of that value's fields.
   */
  fieldsOf?: JsonSchema | undefined
}

/**
 * Walks a JSON Schema and builds a port tree. For each `type: "object"` with
 * `properties`, returns a branch node with children; everything else is a leaf.
 */
export function schemaToTree(schema: JsonSchema | undefined, parentPath = ""): PortNode[] {
  if (!schema || schema.type !== "object" || !schema.properties) return []
  const out: PortNode[] = []
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : [])
  for (const [key, sub] of Object.entries(schema.properties)) {
    const id = parentPath ? `${parentPath}.${key}` : key
    const isObject = sub?.type === "object" && Boolean(sub.properties)
    const children = isObject ? schemaToTree(sub, id) : []
    const node: PortNode = {
      id,
      label: key,
      children,
      isLeaf: !isObject,
    }
    if (required.has(key)) node.required = true
    // Attach schema to leaf ports so the node UI can pick the right widget.
    if (!isObject) node.schema = sub
    out.push(node)
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
export function schemaToRootedTree(schema: JsonSchema | undefined, rootLabel = "input"): PortNode {
  const children = schemaToTree(schema)
  return {
    id: "",
    label: rootLabel,
    children,
    isLeaf: children.length === 0,
  }
}
