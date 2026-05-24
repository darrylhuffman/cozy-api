import type { WebSocket } from "ws"
import type { Breakpoint, ClientMessage, RequestEnvelope, ServerMessage } from "./debug-protocol.js"
import type { AnyNodeOrTrigger, Services } from "../types.js"
import type { LoadedWorkflow } from "./load.js"
import { runWorkflow } from "../exec/run.js"
import { computeExecutionPlan } from "../exec/topology.js"
import { validateWorkflow } from "../workflow/validate.js"
import { buildTriggerSlice, extractParams } from "./trigger-slice.js"
import { LifecycleEmitter } from "../exec/lifecycle.js"
import { resolveCoreNode } from "../core/registry.js"

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
  private lastRequest: {
    workflowPath: string
    triggerNodeId: string
    request: RequestEnvelope
  } | null = null

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

      case "fire": {
        if (this.activeRun) {
          ws.send(
            JSON.stringify({
              type: "run-error",
              runId: this.activeRun.runId,
              message: "another run is in flight",
            } satisfies ServerMessage),
          )
          return
        }
        void this.runFire(msg.workflowPath, msg.triggerNodeId, msg.request)
        return
      }
      case "replay": {
        if (this.activeRun) {
          ws.send(
            JSON.stringify({
              type: "run-error",
              runId: this.activeRun.runId,
              message: "another run is in flight",
            } satisfies ServerMessage),
          )
          return
        }
        const last = this.lastRequest
        if (!last) {
          ws.send(JSON.stringify({ type: "ack", for: "replay" } satisfies ServerMessage))
          return
        }
        void this.runFire(last.workflowPath, last.triggerNodeId, last.request)
        return
      }

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

  private async runFire(
    workflowPath: string,
    triggerNodeId: string,
    request: RequestEnvelope,
  ): Promise<void> {
    const wf = this.deps.getWorkflow(workflowPath)
    if (!wf) {
      this.broadcast({
        type: "run-error",
        runId: "n/a",
        message: `workflow not found: ${workflowPath}`,
      })
      return
    }

    const runId = `r-${Math.random().toString(36).slice(2, 10)}`
    this.activeRun = { runId, workflowPath, triggerNodeId, startedAt: Date.now() }
    this.lastRequest = { workflowPath, triggerNodeId, request }

    // Validate + project trigger slice (mirrors server.ts mountWorkflows logic)
    const { errors, depsByNode } = validateWorkflow(wf.file)
    if (errors.length > 0) {
      this.broadcast({
        type: "run-error",
        runId,
        message: `validation: ${errors.map((e) => `${e.nodeId}.${e.field}: ${e.message}`).join("; ")}`,
      })
      this.activeRun = null
      return
    }
    const projected = buildTriggerSlice(wf.file, triggerNodeId, depsByNode)
    const { depsByNode: sliceDeps } = validateWorkflow(projected)
    const plan = computeExecutionPlan(projected, sliceDeps)

    // Synthesize trigger outputs from the envelope.
    const triggerInstance = wf.file.nodes[triggerNodeId]
    const triggerValues = (triggerInstance?.values ?? {}) as Record<string, unknown>
    const triggerPathTemplate = (triggerValues.path as string | undefined) ?? "/"
    const triggerOutputs: Record<string, unknown> = {
      body: request.body ?? null,
      params: extractParams(triggerPathTemplate, request.path),
      query: request.query ?? {},
      headers: request.headers ?? {},
      context: { requestId: runId, timestamp: Date.now() },
    }

    // Lifecycle: every event becomes an `event` server message.
    const startedAt = Date.now()
    const lifecycle = new LifecycleEmitter()
    for (const type of ["before-node", "after-node", "edge-fired", "error", "complete"] as const) {
      lifecycle.on(type, (ev) => {
        this.broadcast({
          type: "event",
          runId,
          event: ev as never,
          offsetMs: Date.now() - startedAt,
        })
      })
    }

    // Services resolved per-run via the deps factory.
    const services = await this.deps.getServices({ requestId: runId, timestamp: Date.now() })

    // Build the pause hooks.
    const { onBeforeNode, onAfterNode } = this.buildHooks(workflowPath, runId)

    try {
      const result = await runWorkflow({
        workflow: projected,
        plan,
        triggerNodeId,
        triggerOutputs,
        services,
        resolveNode: (uses) => resolveCoreNode(uses) ?? this.deps.resolveNode(uses) ?? null,
        lifecycle,
        onBeforeNode,
        onAfterNode,
      })
      this.broadcast({
        type: "run-complete",
        runId,
        status: result.status,
        body: result.body,
        totalMs: Date.now() - startedAt,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const nodeId =
        err && typeof err === "object" && "nodeId" in err
          ? ((err as { nodeId: unknown }).nodeId as string | undefined)
          : undefined
      this.broadcast({
        type: "run-error",
        runId,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message,
      })
    } finally {
      this.activeRun = null
      this.activePause = null
      this.pauseFrame = null
      this.stepMode = "none"
      this.stepOverNodeId = null
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
