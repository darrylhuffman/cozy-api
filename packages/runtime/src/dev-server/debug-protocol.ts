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

/** Used by the IDE to record what was fired; no longer appears on the wire. */
export interface RequestEnvelope {
  method: string
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
}

/** Wire-friendly version of LifecycleEvent: Error is serialized to {message, stack?}. */
export type WireLifecycleEvent =
  | { type: "before-node"; nodeId: string; input: Record<string, unknown> }
  | {
      type: "after-node"
      nodeId: string
      output: Record<string, unknown>
      durationMs: number
    }
  | { type: "edge-fired"; from: string; to: string; value: unknown }
  | {
      type: "error"
      nodeId: string
      error: { message: string; stack?: string }
    }
  | { type: "complete"; totalMs: number }

export type ClientMessage =
  | { type: "hello"; breakpoints: Breakpoint[] }
  | { type: "set-breakpoints"; breakpoints: Breakpoint[] }
  | { type: "continue"; runId: string }
  | { type: "step"; runId: string }
  | { type: "step-over"; runId: string }
  | { type: "stop"; runId: string }

export type ServerMessage =
  | { type: "ready"; sessionId: string }
  | {
      type: "event"
      runId: string
      event: WireLifecycleEvent
      offsetMs: number
    }
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
  | {
      type: "run-error"
      runId: string
      nodeId?: string
      message: string
      stack?: string
    }
  | {
      type: "log"
      runId: string
      level: "log" | "info" | "warn" | "error"
      message: string
      offsetMs: number
    }
  | { type: "ack"; for: ClientMessage["type"] }

export type { LifecycleEvent }
