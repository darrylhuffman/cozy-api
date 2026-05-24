import type { WebSocket } from "ws"
import type { Breakpoint, ClientMessage, ServerMessage } from "./debug-protocol.js"
import type { AnyNodeOrTrigger, Services } from "../types.js"
import type { LoadedWorkflow } from "./load.js"

export interface DebugSessionDeps {
  /** Look up a loaded workflow by its workspace-relative path. */
  getWorkflow: (workflowPath: string) => LoadedWorkflow | null
  /** Resolve services for a new run. */
  getServices: (ctx: { requestId: string; timestamp: number }) => Promise<Services>
  /** Resolve a node module by `uses` string. */
  resolveNode: (uses: string) => AnyNodeOrTrigger | null
}

interface ActivePause {
  runId: string
  resolve: () => void
  reject: (err: Error) => void
}

interface ActiveRun {
  runId: string
  workflowPath?: string
  triggerNodeId?: string
  startedAt?: number
  lastRequest?: import("./debug-protocol.js").RequestEnvelope
}

interface PauseFrame {
  runId: string
  nodeId: string
  phase: "before" | "after"
}

class AbortError extends Error {
  override name = "AbortError"
}

export class DebugSession {
  private breakpoints = new Map<string, Breakpoint[]>()
  private clients = new Set<WebSocket>()
  private activeRun: ActiveRun | null = null
  private activePause: ActivePause | null = null
  private pauseFrame: PauseFrame | null = null
  stepMode: "none" | "step" | "step-over" = "none"
  stepOverNodeId: string | null = null

  constructor(private deps: DebugSessionDeps) {}

  get clientCount(): number {
    return this.clients.size
  }

  getBreakpoints(workflowPath: string): Breakpoint[] {
    return this.breakpoints.get(workflowPath) ?? []
  }

  connect(ws: WebSocket): void {
    this.clients.add(ws)
  }

  disconnect(ws: WebSocket): void {
    this.clients.delete(ws)
    if (this.clients.size === 0 && this.activePause) {
      this.activePause.reject(new AbortError("client disconnected"))
      this.activePause = null
      this.pauseFrame = null
      this.activeRun = null
      this.stepMode = "none"
      this.stepOverNodeId = null
    }
  }

  broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg)
    for (const ws of this.clients) {
      try {
        ws.send(payload)
      } catch {
        /* dead socket — ignore */
      }
    }
  }

  async onMessage(ws: WebSocket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "hello":
        this.applyBreakpoints(msg.breakpoints)
        ws.send(
          JSON.stringify({
            type: "ready",
            sessionId: this.makeSessionId(),
          } satisfies ServerMessage),
        )
        return

      case "set-breakpoints":
        this.applyBreakpoints(msg.breakpoints)
        ws.send(
          JSON.stringify({
            type: "ack",
            for: "set-breakpoints",
          } satisfies ServerMessage),
        )
        return

      case "continue":
        if (this.activePause) {
          const runId = this.activePause.runId
          this.activePause.resolve()
          this.activePause = null
          this.pauseFrame = null
          this.broadcast({ type: "resumed", runId })
        }
        return

      case "step":
        if (this.activePause) {
          this.stepMode = "step"
          const runId = this.activePause.runId
          this.activePause.resolve()
          this.activePause = null
          this.pauseFrame = null
          this.broadcast({ type: "resumed", runId })
        }
        return

      case "step-over":
        if (this.activePause && this.pauseFrame?.phase === "before") {
          this.stepMode = "step-over"
          this.stepOverNodeId = this.pauseFrame.nodeId
          const runId = this.activePause.runId
          this.activePause.resolve()
          this.activePause = null
          this.pauseFrame = null
          this.broadcast({ type: "resumed", runId })
        }
        return

      case "replay":
        ws.send(
          JSON.stringify({ type: "ack", for: "replay" } satisfies ServerMessage),
        )
        return

      case "fire":
        ws.send(
          JSON.stringify({ type: "ack", for: "fire" } satisfies ServerMessage),
        )
        return

      case "stop":
        if (this.activePause) {
          this.activePause.reject(new AbortError("stopped"))
          this.activePause = null
          this.pauseFrame = null
          this.stepMode = "none"
          this.stepOverNodeId = null
        }
        return
    }
  }

  private applyBreakpoints(next: Breakpoint[]): void {
    // Full replace: clear all existing breakpoints, then rebuild from the new set
    this.breakpoints.clear()
    for (const bp of next) {
      const list = this.breakpoints.get(bp.workflowPath) ?? []
      list.push(bp)
      this.breakpoints.set(bp.workflowPath, list)
    }
  }

  private makeSessionId(): string {
    return `s-${Math.random().toString(36).slice(2, 10)}`
  }

  buildHooks(workflowPath: string, runId: string): {
    onBeforeNode: (nodeId: string, input: Record<string, unknown>) => Promise<void>
    onAfterNode: (nodeId: string, output: Record<string, unknown>) => Promise<void>
  } {
    const shouldPause = (nodeId: string, phase: "before" | "after"): boolean => {
      // `step`: pause at the very next hook call regardless of bps.
      if (this.stepMode === "step") return true
      const bps = this.breakpoints.get(workflowPath) ?? []
      if (phase === "before") {
        // step-over: when we enter a DIFFERENT node than the one being stepped
        // over, we want to pause (we've completed the stepped node).
        if (this.stepMode === "step-over" && this.stepOverNodeId !== nodeId) return true
        return bps.some((b) => b.nodeId === nodeId && b.kind === "before")
      }
      // phase === "after"
      // step-over: suppress port + after bps on the stepped-over node itself.
      if (this.stepMode === "step-over" && this.stepOverNodeId === nodeId) return false
      return bps.some(
        (b) =>
          b.nodeId === nodeId &&
          (b.kind === "after" || b.kind.startsWith("port:")),
      )
    }

    const pause = (
      nodeId: string,
      phase: "before" | "after",
      payload: unknown,
    ): Promise<void> => {
      this.broadcast({ type: "paused", runId, nodeId, phase, payload })
      this.pauseFrame = { runId, nodeId, phase }
      return new Promise<void>((resolve, reject) => {
        this.activePause = { runId, resolve, reject }
      })
    }

    return {
      onBeforeNode: async (nodeId, input) => {
        if (shouldPause(nodeId, "before")) {
          // Clear step modes on actual pause — arming another step needs an
          // explicit command from the client.
          this.stepMode = "none"
          this.stepOverNodeId = null
          await pause(nodeId, "before", input)
        }
      },
      onAfterNode: async (nodeId, output) => {
        if (shouldPause(nodeId, "after")) {
          this.stepMode = "none"
          this.stepOverNodeId = null
          await pause(nodeId, "after", output)
        }
      },
    }
  }

  // Test-only seam helpers
  _setActivePauseForTest(p: ActivePause | null): void {
    this.activePause = p
  }

  _setPauseFrameForTest(f: PauseFrame | null): void {
    this.pauseFrame = f
  }

  _setActiveRunForTest(r: ActiveRun | null): void {
    this.activeRun = r
  }
}
