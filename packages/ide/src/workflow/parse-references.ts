import type { WorkflowFile } from "@/lib/api"

export interface Reference {
  source: {
    /** The node that produces the value */
    nodeId: string
    /** The first path segment — matches an output port id on the source node */
    portId: string
    /** Remaining path segments after portId (e.g. ["email"] in "request.body.email") */
    remainingPath: string[]
  }
  target: {
    /** The node that consumes the value */
    nodeId: string
    /** The field name / input port id on the target node */
    portId: string
  }
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
 * Two shapes are supported:
 *  - per-field object: each value is a reference or literal
 *  - whole-object string: the entire `in:` is a single reference; target.portId
 *    is the empty string (matches the root input port in the IDE).
 *
 * Only strings matching the REFERENCE pattern AND whose leading segment
 * corresponds to a known node id are treated as references. Literals and
 * unresolved references are silently skipped.
 *
 * The returned Reference shape carries:
 *  - source.portId: first path segment (matches the output port on the source node)
 *  - source.remainingPath: deeper path segments (e.g. ["email"] in "request.body.email")
 *  - target.portId: the field name in the consuming node's `in:` block, or
 *                   "" for the whole-object form (matches the root input port)
 */
export function extractReferences(workflow: WorkflowFile): Reference[] {
  const refs: Reference[] = []
  for (const [toNodeId, instance] of Object.entries(workflow.nodes)) {
    if (instance.in === undefined) continue

    if (typeof instance.in === "string") {
      const ref = parseRefString(instance.in, workflow)
      if (ref) {
        refs.push({
          source: ref,
          target: { nodeId: toNodeId, portId: "" },
        })
      }
      continue
    }

    for (const [field, value] of Object.entries(instance.in)) {
      if (typeof value !== "string") continue
      const ref = parseRefString(value, workflow)
      if (!ref) continue
      refs.push({
        source: ref,
        target: { nodeId: toNodeId, portId: field },
      })
    }
  }
  return refs
}

function parseRefString(
  value: string,
  workflow: WorkflowFile,
): Reference["source"] | null {
  if (!REFERENCE.test(value)) return null
  const [nodeId, firstSegment, ...rest] = value.split(".")
  if (!nodeId) return null
  if (!workflow.nodes[nodeId]) return null
  return {
    nodeId,
    portId: firstSegment ?? "out",
    remainingPath: rest,
  }
}
