export interface WorkflowFile {
  cozy: 1
  nodes: Record<string, NodeInstance>
  view?: Record<string, NodeView>
}

export interface NodeInstance {
  uses: string
  in?: Record<string, unknown> // values can be reference strings or literals or {$literal: ...}
  config?: Record<string, unknown>
  after?: string[]
  label?: string
}

export interface NodeView {
  x: number
  y: number
}

/**
 * Parsed reference. Source nodes are split into instance id + path of property keys.
 * "request.body.email"  ->  { nodeId: "request", path: ["body", "email"] }
 * "parseBody"            ->  { nodeId: "parseBody", path: [] }
 */
export interface ParsedReference {
  nodeId: string
  path: string[]
}

/**
 * A resolved input value: either a reference (to be looked up at run time) or a literal.
 */
export type ResolvedInputValue =
  | { kind: "reference"; ref: ParsedReference }
  | { kind: "literal"; value: unknown }
