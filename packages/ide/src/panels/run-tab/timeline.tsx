import { useState } from "react"
import { useDebugSessionStore, type RunRecord } from "@/store/debug-session"

export function Timeline() {
  const runs = useDebugSessionStore((s) => s.runs)
  const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)
  const run = runs.find((r) => r.runId === selectedRunId) ?? runs[0] ?? null

  if (!run) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        No runs yet. Click <strong>Send</strong> to fire a debug run.
      </div>
    )
  }

  const rows = foldEdges(run)

  return (
    <div className="flex flex-col gap-1 font-mono text-[11px]">
      {rows.map((row, i) => (
        <TimelineRow key={i} row={row} />
      ))}
      {run.outcome.kind === "ok" && (
        <div className="text-green-700">
          +{run.outcome.totalMs}ms ● complete {run.outcome.status}
        </div>
      )}
      {run.outcome.kind === "err" && (
        <div className="text-red-700">✕ {run.outcome.message}</div>
      )}
    </div>
  )
}

interface FoldedRow {
  offsetMs: number
  kind: "before" | "after" | "error"
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
      continue
    }
    // complete handled outside (it's on the outcome)
  }
  return rows
}

function TimelineRow({ row }: { row: FoldedRow }) {
  const [open, setOpen] = useState(false)
  const arrow = open ? "▾" : "▸"
  const tone =
    row.kind === "error"
      ? "text-red-700"
      : row.kind === "before"
        ? "text-foreground"
        : "text-muted-foreground"
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left hover:bg-accent/30"
      >
        <span className="w-12 text-muted-foreground">+{row.offsetMs}ms</span>
        <span>{arrow}</span>
        <span className={tone}>{row.kind}</span>
        <span className="text-foreground">{row.nodeId}</span>
        {row.precedingEdges.length > 0 && (
          <span className="ml-1 text-muted-foreground">
            ← {row.precedingEdges.length} input{row.precedingEdges.length > 1 ? "s" : ""}
          </span>
        )}
      </button>
      {open && (
        <pre className="ml-12 max-h-48 overflow-auto rounded-md bg-muted/40 p-2 text-[10px]">
          {row.precedingEdges.length > 0 && (
            <>
              <strong>inputs from edges:</strong>
              {"\n"}
              {JSON.stringify(row.precedingEdges, null, 2)}
              {"\n\n"}
            </>
          )}
          <strong>{row.kind === "before" ? "input" : row.kind === "after" ? "output" : "error"}:</strong>
          {"\n"}
          {row.kind === "error"
            ? String(row.payload)
            : JSON.stringify(row.payload, null, 2)}
        </pre>
      )}
    </div>
  )
}
