import type { ClientMessage } from "@darrylondil/lorien-runtime"
import { useDebugSessionStore } from "@/store/debug-session"

export function StatusBanner({ send }: { send: (msg: ClientMessage) => void }) {
  const status = useDebugSessionStore((s) => s.status)
  const pausedFrame = useDebugSessionStore((s) => s.pausedFrame)

  if (status === "idle") return null

  return (
    <div
      className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs"
      data-testid="status-banner"
    >
      <div>
        {status === "running" && <span>▶ Running…</span>}
        {status === "paused" && pausedFrame && (
          <span>
            ⏸ Paused at <code className="font-mono">{pausedFrame.nodeId}</code>.{pausedFrame.phase}
          </span>
        )}
        {status === "completed" && <span className="text-green-700">✓ Completed</span>}
        {status === "errored" && <span className="text-red-700">✕ Errored</span>}
      </div>
      <div className="flex gap-1">
        {status === "paused" && (
          <>
            <button
              type="button"
              className="rounded-md border bg-background px-2 py-1 hover:bg-accent"
              onClick={() => send({ type: "continue" })}
            >
              Continue
            </button>
            <button
              type="button"
              className="rounded-md border bg-background px-2 py-1 hover:bg-accent"
              onClick={() => send({ type: "step" })}
            >
              Step
            </button>
            {pausedFrame?.phase === "before" && (
              <button
                type="button"
                className="rounded-md border bg-background px-2 py-1 hover:bg-accent"
                onClick={() => send({ type: "step-over" })}
              >
                Step Over
              </button>
            )}
          </>
        )}
        {(status === "running" || status === "paused") && (
          <button
            type="button"
            className="rounded-md border bg-background px-2 py-1 text-red-700 hover:bg-accent"
            onClick={() => send({ type: "stop" })}
          >
            Stop
          </button>
        )}
        {(status === "completed" || status === "errored") && (
          <button
            type="button"
            className="rounded-md border bg-background px-2 py-1 hover:bg-accent"
            onClick={() => send({ type: "replay" })}
          >
            Replay
          </button>
        )}
      </div>
    </div>
  )
}
