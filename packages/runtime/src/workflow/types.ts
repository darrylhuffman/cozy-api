export type { NodeInstance, NodeView, WorkflowFile } from "./schema.js"

/**
 * Parsed reference. Source nodes are split into instance id + path of property keys.
 * "request.body.email"  ->  { nodeId: "request", path: ["body", "email"] }
 * "parseBody"            ->  { nodeId: "parseBody", path: [] }
 */
export interface ParsedReference {
  nodeId: string
  path: string[]
}
