import type { WorkflowFile } from "@/lib/api"

export interface Reference {
  from: { nodeId: string; path: string[] }
  to: { nodeId: string; field: string }
}

/**
 * An identifier reference looks like: nodeId  or  nodeId.output.nested
 * It must start with a letter/underscore/$, followed by word chars/$.
 * Dot-separated segments follow the same rules.
 * Anything else (string literals, numbers, etc.) is silently skipped.
 */
const REFERENCE = /^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*$/

/**
 * Extracts all node-to-node references from `in:` blocks.
 *
 * Only string values matching the REFERENCE pattern AND whose leading
 * segment corresponds to a known node id are treated as references.
 * Literals and unresolved references are silently skipped.
 */
export function extractReferences(workflow: WorkflowFile): Reference[] {
  const refs: Reference[] = []
  for (const [toNodeId, instance] of Object.entries(workflow.nodes)) {
    if (!instance.in) continue
    for (const [field, value] of Object.entries(instance.in)) {
      if (typeof value !== "string") continue
      if (!REFERENCE.test(value)) continue
      const [nodeId, ...path] = value.split(".")
      if (!nodeId) continue
      if (!workflow.nodes[nodeId]) continue // unresolved — skip
      refs.push({ from: { nodeId, path }, to: { nodeId: toNodeId, field } })
    }
  }
  return refs
}
