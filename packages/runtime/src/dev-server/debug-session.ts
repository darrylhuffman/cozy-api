import type { WebSocket } from "ws"
import type {
  Breakpoint,
  ClientMessage,
  ServerMessage,
} from "./debug-protocol.js"

interface PauseFrame {
  runId: string
  nodeId: string
  phase: "before" | "after"
}

interface RunDebugState {
  runId: string
  workflowPath: string
  startedAt: number
  pause: {
    resolve: () => void
    reject: (err: Error) => void
    frame: PauseFrame
  } | null
  stepMode: "none" | "step" | "step-over"
  stepOverNodeId: string | null
}

class AbortError extends Error {
  override name = "AbortError"
}

export class DebugSession {
  private breakpoints = new Map<string, Breakpoint[]>()
  private clients = new Set<WebSocket>()
  private runs = new Map<string, RunDebugState>()

  get clientCount(): number {
    return this.clients.size
  }

  getBreakpoints(workflowPath: string): Breakpoint[] {
    return this.breakpoints.get(workflowPath) ?? []
  }

  getRunStartedAt(runId: string): number | null {
    return this.runs.get(runId)?.startedAt ?? null
  }

  connect(ws: WebSocket): void {
    this.clients.add(ws)
  }

  disconnect(ws: WebSocket): void {
    this.clients.delete(ws)
    if (this.clients.size === 0) {
      for (const r of this.runs.values()) {
        if (r.pause) {
          r.pause.reject(new AbortError("client disconnected"))
          r.pause = null
        }
        r.stepMode = "none"
        r.stepOverNodeId = null
      }
    }
  }

  broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg)
    for (const ws of this.clients) {
      try {
        ws.send(payload)
      } catch {
        /* dead socket */
      }
    }
  }

  registerRun(
    workflowPath: string,
    runId: string,
    startedAt: number,
  ): {
    onBeforeNode: (nodeId: string, input: Record<string, unknown>) => Promise<void>
    onAfterNode: (nodeId: string, output: Record<string, unknown>) => Promise<void>
  } {
    const state: RunDebugState = {
      runId,
      workflowPath,
      startedAt,
      pause: null,
      stepMode: "none",
      stepOverNodeId: null,
    }
    this.runs.set(runId, state)

    const shouldPause = (
      nodeId: string,
      phase: "before" | "after",
    ): boolean => {
      if (state.stepMode === "step") return true
      const bps = this.breakpoints.get(workflowPath) ?? []
      if (phase === "before") {
        if (
          state.stepMode === "step-over" &&
          state.stepOverNodeId !== nodeId
        )
          return true
        return bps.some((b) => b.nodeId === nodeId && b.kind === "before")
      }
      if (state.stepMode === "step-over" && state.stepOverNodeId === nodeId)
        return false
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
      const frame: PauseFrame = { runId, nodeId, phase }
      this.broadcast({ type: "paused", runId, nodeId, phase, payload })
      return new Promise<void>((resolve, reject) => {
        state.pause = { resolve, reject, frame }
      })
    }

    return {
      onBeforeNode: async (nodeId, input) => {
        if (shouldPause(nodeId, "before")) {
          state.stepMode = "none"
          state.stepOverNodeId = null
          await pause(nodeId, "before", input)
        }
      },
      onAfterNode: async (nodeId, output) => {
        if (shouldPause(nodeId, "after")) {
          state.stepMode = "none"
          state.stepOverNodeId = null
          await pause(nodeId, "after", output)
        }
      },
    }
  }

  unregisterRun(runId: string): void {
    const state = this.runs.get(runId)
    if (state?.pause) {
      state.pause.reject(new AbortError("run unregistered while paused"))
    }
    this.runs.delete(runId)
  }

  /**
   * Used by the IDE command's hot-reload pipeline: when a `.workflow` file
   * changes, all current runs are invalidated. Reject any paused pause-promise
   * with AbortError so the handler's catch block can broadcast run-error via
   * the normal `opts.debug?.onError` path; then remove the run from the map.
   *
   * Does NOT broadcast run-error itself — that's the handler's responsibility
   * and would otherwise double up.
   */
  abortAllRuns(): void {
    for (const runId of [...this.runs.keys()]) {
      const state = this.runs.get(runId)
      if (state?.pause) {
        state.pause.reject(new AbortError("run aborted: workflow reloaded"))
        state.pause = null
      }
      this.runs.delete(runId)
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
        this.continueRun(msg.runId)
        return
      case "step":
        this.stepRun(msg.runId)
        return
      case "step-over":
        this.stepOverRun(msg.runId)
        return
      case "stop":
        this.stopRun(msg.runId)
        return
    }
  }

  private continueRun(runId: string): void {
    const r = this.runs.get(runId)
    if (!r?.pause) return
    r.pause.resolve()
    r.pause = null
    this.broadcast({ type: "resumed", runId })
  }

  private stepRun(runId: string): void {
    const r = this.runs.get(runId)
    if (!r?.pause) return
    r.stepMode = "step"
    r.pause.resolve()
    r.pause = null
    this.broadcast({ type: "resumed", runId })
  }

  private stepOverRun(runId: string): void {
    const r = this.runs.get(runId)
    if (!r?.pause || r.pause.frame.phase !== "before") return
    r.stepMode = "step-over"
    r.stepOverNodeId = r.pause.frame.nodeId
    r.pause.resolve()
    r.pause = null
    this.broadcast({ type: "resumed", runId })
  }

  private stopRun(runId: string): void {
    const r = this.runs.get(runId)
    if (!r?.pause) return
    r.pause.reject(new AbortError("stopped"))
    r.pause = null
    r.stepMode = "none"
    r.stepOverNodeId = null
  }

  private applyBreakpoints(next: Breakpoint[]): void {
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

  // Test-only seam helpers
  _setActivePauseForTest(runId: string, p: RunDebugState["pause"]): void {
    const r = this.runs.get(runId)
    if (r) r.pause = p
  }
  _setStepModeForTest(
    runId: string,
    mode: RunDebugState["stepMode"],
    nodeId: string | null = null,
  ): void {
    const r = this.runs.get(runId)
    if (r) {
      r.stepMode = mode
      r.stepOverNodeId = nodeId
    }
  }
}
