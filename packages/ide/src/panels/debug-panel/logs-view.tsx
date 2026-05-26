import { useState } from "react"
import { useDebugSessionStore } from "@/store/debug-session"

interface DisplayRow {
  offsetMs: number
  level: "log" | "info" | "warn" | "error"
  message: string
  stack?: string
}

export function LogsView({ runId }: { runId: string | null }) {
  const run = useDebugSessionStore((s) =>
    runId ? s.runs.find((r) => r.runId === runId) ?? null : null,
  )
  const [filter, setFilter] = useState("")

  if (!run) return null

  const rows: DisplayRow[] = []
  for (const log of run.logs)
    rows.push({ offsetMs: log.offsetMs, level: log.level, message: log.message })

  // Surface error events too
  for (const e of run.events) {
    if (e.event.type === "error") {
      rows.push({
        offsetMs: e.offsetMs,
        level: "error",
        message: `[${e.event.nodeId}] ${e.event.error.message}`,
        ...(e.event.error.stack ? { stack: e.event.error.stack } : {}),
      })
    }
  }

  // run-error outcome stack
  if (run.outcome.kind === "errored" && run.outcome.stack) {
    rows.push({
      offsetMs: run.outcome.totalMs ?? 0,
      level: "error",
      message: run.outcome.message,
      stack: run.outcome.stack,
    })
  }

  rows.sort((a, b) => a.offsetMs - b.offsetMs)

  const filtered = filter
    ? rows.filter((r) => r.message.toLowerCase().includes(filter.toLowerCase()))
    : rows

  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        No logs for this run yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      <input
        type="text"
        placeholder="Filter logs…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="rounded-md border bg-background px-2 py-1 font-mono"
      />
      <div className="flex flex-col gap-1 font-mono text-[11px]">
        {filtered.map((row, i) => (
          <LogRow key={i} row={row} />
        ))}
      </div>
    </div>
  )
}

function LogRow({ row }: { row: DisplayRow }) {
  const [open, setOpen] = useState(false)
  const tone =
    row.level === "error"
      ? "text-red-700"
      : row.level === "warn"
        ? "text-yellow-700"
        : row.level === "info"
          ? "text-blue-700"
          : "text-foreground"
  return (
    <div data-testid="log-row">
      <button
        type="button"
        onClick={() => row.stack && setOpen((v) => !v)}
        className="flex w-full items-start gap-2 text-left hover:bg-accent/30"
      >
        <span className="w-12 text-muted-foreground">+{row.offsetMs}ms</span>
        <span className={`w-12 uppercase ${tone}`}>{row.level}</span>
        <span className="flex-1 whitespace-pre-wrap">{row.message}</span>
      </button>
      {open && row.stack && (
        <pre className="ml-24 max-h-48 overflow-auto rounded-md bg-muted/40 p-2 text-[10px]">
          {row.stack}
        </pre>
      )}
    </div>
  )
}
