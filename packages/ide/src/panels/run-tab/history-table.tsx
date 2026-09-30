import { useState } from "react"
import { cn } from "@/lib/utils"
import { type RequestHistoryEntry, useRequestHistoryStore } from "@/store/request-history"
import { methodTone } from "./method-tone"

export function HistoryTable() {
  const entries = useRequestHistoryStore((s) => s.entries)

  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <div className="flex items-baseline gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          History
        </span>
        <span className="text-[11px] text-muted-foreground">this session</span>
      </div>
      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          No requests yet. Send a request to populate the history.
        </div>
      ) : (
        <div className="flex flex-col gap-px">
          {entries.map((e) => (
            <HistoryRow key={e.id} entry={e} />
          ))}
        </div>
      )}
    </div>
  )
}

function HistoryRow({ entry }: { entry: RequestHistoryEntry }) {
  const [open, setOpen] = useState(false)
  const startedAt = new Date(entry.startedAt).toLocaleTimeString([], { hour12: false })
  const { outcome } = entry
  return (
    <div className={cn("rounded-md", open && "bg-muted/30 ring-1 ring-border ring-inset")}>
      <button
        type="button"
        data-testid="history-row"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left font-mono text-[11px] hover:bg-accent/60"
      >
        <StatusIndicator outcome={outcome} />
        <span className="shrink-0 text-muted-foreground">{startedAt}</span>
        <span className={cn("shrink-0 font-medium", methodTone(entry.request.method))}>
          {entry.request.method}
        </span>
        <span className="min-w-0 flex-1 truncate">{entry.request.path}</span>
        <span
          className={cn(
            "shrink-0 whitespace-nowrap",
            outcome.kind === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {outcome.kind === "ok" || outcome.kind === "error"
            ? `${outcome.status} (${outcome.durationMs}ms)`
            : outcome.kind === "in-flight"
              ? "in flight"
              : "network error"}
        </span>
      </button>
      {open && (
        <div data-testid="response-details" className="border-t border-border p-2 text-xs">
          {outcome.kind === "in-flight" && <div className="text-muted-foreground">In flight…</div>}
          {outcome.kind === "network-error" && (
            <div className="text-destructive">Network error: {outcome.message}</div>
          )}
          {(outcome.kind === "ok" || outcome.kind === "error") && (
            <ResponseView outcome={outcome} />
          )}
        </div>
      )}
    </div>
  )
}

function StatusIndicator({ outcome }: { outcome: RequestHistoryEntry["outcome"] }) {
  if (outcome.kind === "in-flight")
    return (
      <span
        data-testid="status-in-flight"
        className="inline-block size-2 shrink-0 animate-spin rounded-full border border-muted-foreground border-t-transparent"
      />
    )
  if (outcome.kind === "ok")
    return (
      <span
        data-testid="status-ok"
        className="inline-block size-1.5 shrink-0 rounded-full bg-success"
      />
    )
  if (outcome.kind === "error")
    return (
      <span
        data-testid="status-error"
        className="inline-block size-1.5 shrink-0 rounded-full bg-destructive"
      />
    )
  return (
    <span
      data-testid="status-network-error"
      className="inline-block size-1.5 shrink-0 rounded-full bg-muted-foreground"
    />
  )
}

function ResponseView({
  outcome,
}: {
  outcome: Extract<RequestHistoryEntry["outcome"], { kind: "ok" | "error" }>
}) {
  const bodyText =
    typeof outcome.body === "string" ? outcome.body : JSON.stringify(outcome.body, null, 2)
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Response headers
        </div>
        <pre className="max-h-24 overflow-auto rounded-md bg-background p-2 font-mono text-[10px]">
          {Object.entries(outcome.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")}
        </pre>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Response body
        </div>
        <pre className="max-h-48 overflow-auto rounded-md bg-background p-2 font-mono text-[10px]">
          {bodyText}
        </pre>
      </div>
    </div>
  )
}
