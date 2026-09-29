import {
  type DebugIntegration,
  type DebugSession,
  LifecycleEmitter,
} from "@darrylondil/lorien-runtime"

/**
 * Builds the `DebugIntegration` used by the IDE command. The factory exists so
 * the wire-side broadcast (run-started, events, run-complete, run-error) can be
 * unit-tested without standing up the full IDE HTTP server.
 *
 * The returned integration is closed over `debugSession`; all broadcasts and
 * registrations route through it.
 */
export function makeDebugIntegration(debugSession: DebugSession): DebugIntegration {
  return {
    newRunId: () => `r-${Math.random().toString(36).slice(2, 10)}`,
    buildRun: (runId, workflowPath, triggerNodeId, request) => {
      debugSession.broadcast({
        type: "run-started",
        runId,
        workflowPath,
        triggerNodeId,
        request,
      })
      const startedAt = Date.now()
      const lifecycle = new LifecycleEmitter()
      for (const t of [
        "before-node",
        "after-node",
        "edge-fired",
        "error",
        "complete",
      ] as const) {
        lifecycle.on(t, (ev) => {
          const wireEvent =
            ev.type === "error"
              ? {
                  type: "error" as const,
                  nodeId: ev.nodeId,
                  error: {
                    message: ev.error.message,
                    ...(ev.error.stack !== undefined ? { stack: ev.error.stack } : {}),
                  },
                }
              : ev
          debugSession.broadcast({
            type: "event",
            runId,
            event: wireEvent as never,
            offsetMs: Date.now() - startedAt,
          })
        })
      }
      const { onBeforeNode, onAfterNode } = debugSession.registerRun(
        workflowPath,
        runId,
        startedAt,
      )
      return { lifecycle, onBeforeNode, onAfterNode }
    },
    onResult: (runId, result, totalMs) => {
      debugSession.broadcast({
        type: "run-complete",
        runId,
        status: result.status,
        body: result.body,
        totalMs,
      })
      debugSession.unregisterRun(runId)
    },
    onError: (runId, err, _totalMs) => {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      const nodeId =
        err && typeof err === "object" && "nodeId" in err
          ? ((err as { nodeId: unknown }).nodeId as string | undefined)
          : undefined
      debugSession.broadcast({
        type: "run-error",
        runId,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message,
        ...(stack !== undefined ? { stack } : {}),
      })
      debugSession.unregisterRun(runId)
    },
  }
}
