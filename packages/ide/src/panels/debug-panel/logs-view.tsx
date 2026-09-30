import { Filter } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { useDebugSessionStore } from "@/store/debug-session"
import { SectionLabel } from "./section-label"

interface DisplayRow {
  offsetMs: number
  level: "log" | "info" | "warn" | "error"
  message: string
  stack?: string
}

export function LogsView({ runId }: { runId: string | null }) {
  const run = useDebugSessionStore((s) =>
    runId ? (s.runs.find((r) => r.runId === runId) ?? null) : null,
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

  return (
    <div className="flex flex-col pb-3">
      <div className="flex h-9 shrink-0 items-center gap-2 px-3.5">
        <SectionLabel className="flex-1">Logs</SectionLabel>
        {rows.length > 0 && (
          <label className="flex h-[26px] w-[200px] max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 text-muted-foreground focus-within:ring-1 focus-within:ring-ring">
            <Filter aria-hidden className="size-3 shrink-0" />
            <input
              type="text"
              placeholder="Filter logs…"
              aria-label="Filter logs"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="mx-3.5 rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
          No logs for this run yet.
        </div>
      ) : (
        <div className="flex flex-col gap-1 px-3.5 font-mono text-[11.5px]">
          {filtered.map((row) => (
            <LogRow key={`${row.offsetMs}-${row.level}-${row.message.slice(0, 40)}`} row={row} />
          ))}
        </div>
      )}
    </div>
  )
}

const levelTone: Record<DisplayRow["level"], string> = {
  error: "text-destructive",
  warn: "text-warning",
  info: "text-info",
  log: "text-muted-foreground",
}

function LogRow({ row }: { row: DisplayRow }) {
  const [open, setOpen] = useState(false)
  const isError = row.level === "error"
  return (
    <div data-testid="log-row" className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={row.stack ? open : undefined}
        onClick={() => row.stack && setOpen((v) => !v)}
        className={cn(
          "-mx-1.5 flex items-start gap-3 rounded-[5px] px-1.5 py-0.5 text-left",
          isError ? "bg-destructive/10" : "hover:bg-accent/50",
        )}
      >
        <span className="w-12 shrink-0 text-muted-foreground">+{row.offsetMs}ms</span>
        <span className={cn("w-[42px] shrink-0 uppercase", levelTone[row.level])}>{row.level}</span>
        <span
          className={cn(
            "min-w-0 flex-1 whitespace-pre-wrap break-words",
            isError ? "text-foreground" : "text-foreground/85",
          )}
        >
          {row.message}
        </span>
      </button>
      {open && row.stack && (
        <pre className="ml-[60px] max-h-48 overflow-auto text-[11px] leading-normal text-muted-foreground">
          {row.stack}
        </pre>
      )}
    </div>
  )
}
