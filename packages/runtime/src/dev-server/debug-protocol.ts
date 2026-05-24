import type { LifecycleEvent } from "../exec/lifecycle.js"

/** A breakpoint on a node or output port. Stored per workflow path. */
export interface Breakpoint {
  workflowPath: string
  nodeId: string
  /**
   * - "before"      → pause in onBeforeNode for this node
   * - "after"       → pause in onAfterNode for this node
   * - `port:${id}`  → pause in onAfterNode if this node has a port-bp matching
   */
  kind: "before" | "after" | `port:${string}`
}

/** Synthesized request envelope for a debug-initiated workflow run. */
export interface RequestEnvelope {
  method: string
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
}

export type ClientMessage =
  | { type: "hello"; breakpoints: Breakpoint[] }
  | { type: "set-breakpoints"; breakpoints: Breakpoint[] }
  | {
      type: "fire"
      workflowPath: string
      triggerNodeId: string
      request: RequestEnvelope
    }
  | { type: "continue" }
  | { type: "step" }
  | { type: "step-over" }
  | { type: "replay" }
  | { type: "stop" }

export type ServerMessage =
  | { type: "ready"; sessionId: string }
  | { type: "event"; runId: string; event: LifecycleEvent; offsetMs: number }
  | {
      type: "paused"
      runId: string
      nodeId: string
      phase: "before" | "after"
      payload: unknown
    }
  | { type: "resumed"; runId: string }
  | {
      type: "run-complete"
      runId: string
      status: number
      body: unknown
      totalMs: number
    }
  | { type: "run-error"; runId: string; nodeId?: string; message: string }
  | { type: "ack"; for: ClientMessage["type"] }
