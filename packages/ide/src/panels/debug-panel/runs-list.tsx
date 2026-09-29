import { useDebugSessionStore, type RunRecord } from "@/store/debug-session"
import { cn } from "@/lib/utils"

export function RunsList() {
  const runs = useDebugSessionStore((s) => s.runs)
  const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)
  const selectRun = useDebugSessionStore((s) => s.selectRun)

  if (runs.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        No runs yet. Fire a request from the Send tab or hit the dev server
        from curl / Postman.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      {runs.map((r) => (
        <button
          key={r.runId}
          type="button"
          data-testid="runs-row"
          onClick={() => selectRun(r.runId)}
          className={cn(
            "flex items-center gap-2 rounded-md border px-2 py-1 text-left hover:bg-accent/30",
            selectedRunId === r.runId && "bg-accent/40 ring-1 ring-primary",
          )}
        >
          <StatusBadge run={r} />
          <span className="w-16 text-muted-foreground">
            {new Date(r.startedAt).toLocaleTimeString()}
          </span>
          <span className="w-12 font-mono">{r.request.method}</span>
          <span className="flex-1 truncate font-mono">{r.request.path}</span>
        </button>
      ))}
    </div>
  )
}

function StatusBadge({ run }: { run: RunRecord }) {
  const out = run.outcome
  if (out.kind === "running")
    return <span className="text-blue-500">▶</span>
  if (out.kind === "paused" && run.pausedFrame)
    return <span className="text-yellow-600 font-mono text-[10px]">⏸ {run.pausedFrame.nodeId}</span>
  if (out.kind === "ok")
    return <span className="text-green-600 font-mono text-[10px]">✓ {out.status}</span>
  if (out.kind === "errored")
    return <span className="text-red-600 font-mono text-[10px]">✕</span>
  return null
}
