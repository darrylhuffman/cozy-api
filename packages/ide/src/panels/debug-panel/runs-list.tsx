import { cn } from "@/lib/utils"
import { type RunRecord, useDebugSessionStore } from "@/store/debug-session"

type Tone = "info" | "destructive" | "warning" | "success"

const pillTone: Record<Tone, string> = {
  info: "bg-info/15 text-info",
  destructive: "bg-destructive/15 text-destructive",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
}

const selectedTone: Record<Tone, string> = {
  info: "bg-info/10 ring-info/45",
  destructive: "bg-destructive/10 ring-destructive/45",
  warning: "bg-warning/10 ring-warning/45",
  success: "bg-success/10 ring-success/45",
}

function runStatus(run: RunRecord): { label: string; tone: Tone; title?: string } {
  const out = run.outcome
  if (out.kind === "running") return { label: "Running", tone: "info" }
  if (out.kind === "paused")
    return {
      label: "Paused",
      tone: "warning",
      ...(run.pausedFrame ? { title: `Paused at ${run.pausedFrame.nodeId}` } : {}),
    }
  if (out.kind === "ok")
    return { label: String(out.status), tone: out.status < 400 ? "success" : "destructive" }
  return { label: "Err", tone: "destructive", title: out.message }
}

export function RunsList() {
  const runs = useDebugSessionStore((s) => s.runs)
  const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)
  const selectRun = useDebugSessionStore((s) => s.selectRun)

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
        No runs yet. Send from the Run tab, or hit the dev server from curl.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {runs.map((r) => {
        const status = runStatus(r)
        const selected = selectedRunId === r.runId
        return (
          <button
            key={r.runId}
            type="button"
            data-testid="runs-row"
            aria-current={selected ? "true" : undefined}
            onClick={() => selectRun(r.runId)}
            className={cn(
              "flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-left",
              selected ? ["ring-1 ring-inset", selectedTone[status.tone]] : "hover:bg-accent/50",
            )}
          >
            <span
              title={status.title}
              className={cn(
                "shrink-0 rounded-full px-1.5 py-px font-mono text-[10px] font-semibold uppercase leading-4",
                pillTone[status.tone],
              )}
            >
              {status.label}
            </span>
            <span
              className={cn("min-w-0 truncate font-mono text-[11px]", selected && "font-medium")}
            >
              <span>{r.request.method}</span> <span>{r.request.path}</span>
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {new Date(r.startedAt).toLocaleTimeString()}
            </span>
          </button>
        )
      })}
    </div>
  )
}
