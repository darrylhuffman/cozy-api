import { useState } from "react"
import { cn } from "@/lib/utils"
import { type RunRecord, useDebugSessionStore } from "@/store/debug-session"
import { SectionLabel } from "./section-label"

export function Timeline({ runId }: { runId: string | null }) {
  const run = useDebugSessionStore((s) =>
    runId ? (s.runs.find((r) => r.runId === runId) ?? null) : null,
  )

  return (
    <div className="flex flex-col pb-3">
      <div className="flex h-9 shrink-0 items-center px-3.5">
        <SectionLabel>Timeline</SectionLabel>
      </div>
      {run ? (
        <div className="flex flex-col gap-1 px-3.5 font-mono text-[11.5px]">
          {foldEdges(run).map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the timeline only ever appends
            <TimelineRow key={i} row={row} />
          ))}
          {run.outcome.kind === "ok" && (
            <div className="flex gap-3 text-success">
              <span className="w-12 shrink-0 text-muted-foreground">+{run.outcome.totalMs}ms</span>
              <span>● complete {run.outcome.status}</span>
            </div>
          )}
          {run.outcome.kind === "errored" && (
            <div className="flex gap-3 text-destructive">
              <span className="w-12 shrink-0" />
              <span className="min-w-0 break-words">✕ {run.outcome.message}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="mx-3.5 rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
          No run selected.
        </div>
      )}
    </div>
  )
}

interface FoldedRow {
  offsetMs: number
  kind: "before" | "after" | "error" | "skipped"
  nodeId: string
  payload: unknown
  precedingEdges: Array<{ from: string; to: string; value: unknown }>
}

function foldEdges(run: RunRecord): FoldedRow[] {
  const rows: FoldedRow[] = []
  let pendingEdges: FoldedRow["precedingEdges"] = []
  for (const e of run.events) {
    if (e.event.type === "edge-fired") {
      pendingEdges.push({ from: e.event.from, to: e.event.to, value: e.event.value })
      continue
    }
    if (e.event.type === "before-node") {
      rows.push({
        offsetMs: e.offsetMs,
        kind: "before",
        nodeId: e.event.nodeId,
        payload: e.event.input,
        precedingEdges: pendingEdges,
      })
      pendingEdges = []
      continue
    }
    if (e.event.type === "after-node") {
      rows.push({
        offsetMs: e.offsetMs,
        kind: "after",
        nodeId: e.event.nodeId,
        payload: e.event.output,
        precedingEdges: [],
      })
      continue
    }
    if (e.event.type === "error") {
      rows.push({
        offsetMs: e.offsetMs,
        kind: "error",
        nodeId: e.event.nodeId,
        payload: e.event.error,
        precedingEdges: [],
      })
    }
    // A branch not taken: its `when` was false, or it reads a skipped node.
    if (e.event.type === "skipped") {
      rows.push({
        offsetMs: e.offsetMs,
        kind: "skipped",
        nodeId: e.event.nodeId,
        payload: "Not run: its condition was false, or it reads a node that didn't run.",
        precedingEdges: [],
      })
    }
    // complete handled outside (it's on the outcome)
  }
  return rows
}

const phaseTone: Record<FoldedRow["kind"], string> = {
  before: "text-info",
  after: "text-success",
  error: "text-destructive",
  skipped: "text-muted-foreground",
}

function TimelineRow({ row }: { row: FoldedRow }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "-mx-1.5 flex items-center gap-3 rounded-[5px] px-1.5 py-0.5 text-left hover:bg-accent/50",
          open && "bg-accent/50",
        )}
      >
        <span className="w-12 shrink-0 text-muted-foreground">+{row.offsetMs}ms</span>
        <span className={cn("w-12 shrink-0", phaseTone[row.kind])}>{row.kind}</span>
        <span className="min-w-0 truncate text-foreground">{row.nodeId}</span>
        {row.precedingEdges.length > 0 && (
          <span className="shrink-0 text-muted-foreground">
            ← {row.precedingEdges.length} input{row.precedingEdges.length > 1 ? "s" : ""}
          </span>
        )}
      </button>
      {open && (
        <pre className="ml-[60px] max-h-48 overflow-auto rounded-md border border-border bg-background px-2.5 py-2 text-[11px] leading-normal">
          {row.precedingEdges.length > 0 && (
            <>
              <span className="text-muted-foreground">inputs from edges</span>
              {"\n"}
              {JSON.stringify(row.precedingEdges, null, 2)}
              {"\n\n"}
            </>
          )}
          <span className="text-muted-foreground">
            {row.kind === "before"
              ? "input"
              : row.kind === "after"
                ? "output"
                : row.kind === "skipped"
                  ? "why"
                  : "error"}
          </span>
          {"\n"}
          {row.kind === "error" || row.kind === "skipped"
            ? String(row.payload)
            : JSON.stringify(row.payload, null, 2)}
        </pre>
      )}
    </div>
  )
}
