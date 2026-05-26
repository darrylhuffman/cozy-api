import { useState } from "react"
import {
  useRequestHistoryStore,
  type RequestHistoryEntry,
} from "@/store/request-history"

export function HistoryTable() {
  const entries = useRequestHistoryStore((s) => s.entries)

  if (entries.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        No requests yet. Send a request to populate the history.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        History
      </div>
      {entries.map((e) => (
        <HistoryRow key={e.id} entry={e} />
      ))}
    </div>
  )
}

function HistoryRow({ entry }: { entry: RequestHistoryEntry }) {
  const [open, setOpen] = useState(false)
  const startedAt = new Date(entry.startedAt).toLocaleTimeString()
  return (
    <div className="rounded-md border bg-background">
      <button
        type="button"
        data-testid="history-row"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent/30"
      >
        <StatusIndicator outcome={entry.outcome} />
        <span className="w-16 text-muted-foreground">{startedAt}</span>
        <span className="w-12 font-mono">{entry.request.method}</span>
        <span className="flex-1 truncate font-mono">{entry.request.path}</span>
        {entry.outcome.kind === "ok" || entry.outcome.kind === "error" ? (
          <span className="text-muted-foreground">
            {entry.outcome.status} ({entry.outcome.durationMs}ms)
          </span>
        ) : null}
      </button>
      {open && (
        <div data-testid="response-details" className="border-t bg-muted/10 p-2">
          {entry.outcome.kind === "in-flight" && (
            <div className="text-muted-foreground">In flight…</div>
          )}
          {entry.outcome.kind === "network-error" && (
            <div className="text-red-700">Network error: {entry.outcome.message}</div>
          )}
          {(entry.outcome.kind === "ok" || entry.outcome.kind === "error") && (
            <ResponseView outcome={entry.outcome} />
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
        className="inline-block h-2 w-2 animate-spin rounded-full border border-muted-foreground border-t-transparent"
      />
    )
  if (outcome.kind === "ok")
    return (
      <span
        data-testid="status-ok"
        className="inline-block h-2 w-2 rounded-full bg-green-500"
      />
    )
  if (outcome.kind === "error")
    return (
      <span
        data-testid="status-error"
        className="inline-block h-2 w-2 rounded-full bg-red-500"
      />
    )
  return (
    <span
      data-testid="status-network-error"
      className="inline-block h-2 w-2 rounded-full bg-gray-400"
    />
  )
}

function ResponseView({
  outcome,
}: {
  outcome: Extract<RequestHistoryEntry["outcome"], { kind: "ok" | "error" }>
}) {
  const bodyText =
    typeof outcome.body === "string"
      ? outcome.body
      : JSON.stringify(outcome.body, null, 2)
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Response headers
        </div>
        <pre className="max-h-24 overflow-auto rounded-md bg-muted/40 p-2 text-[10px]">
          {Object.entries(outcome.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")}
        </pre>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Response body
        </div>
        <pre className="max-h-48 overflow-auto rounded-md bg-muted/40 p-2 text-[10px]">
          {bodyText}
        </pre>
      </div>
    </div>
  )
}
