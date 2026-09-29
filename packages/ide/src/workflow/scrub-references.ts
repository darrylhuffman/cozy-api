import type { NodeInstance } from "@/lib/api"

/**
 * Strips all `in:` references pointing at `targetId` from a single node
 * instance. Handles both per-field (`in: {...}`) and whole-object (`in: "..."`)
 * forms. Returns the original instance unchanged if nothing references targetId.
 */
export function scrubReferencesTo(node: NodeInstance, targetId: string): NodeInstance {
  if (!node.in) return node

  if (typeof node.in === "string") {
    if (node.in === targetId || node.in.startsWith(`${targetId}.`)) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { in: _drop, ...rest } = node
      return rest
    }
    return node
  }

  // per-field object form
  const nextIn: Record<string, string> = {}
  for (const [field, value] of Object.entries(node.in)) {
    if (
      typeof value === "string" &&
      (value === targetId || value.startsWith(`${targetId}.`))
    ) {
      continue // strip
    }
    nextIn[field] = value
  }

  if (Object.keys(nextIn).length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { in: _drop, ...rest } = node
    return rest
  }
  return { ...node, in: nextIn }
}
