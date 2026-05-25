import { useState } from "react"
import type { ClientMessage, RequestEnvelope } from "@darrylondil/lorien-runtime"
import { useDebugSessionStore } from "@/store/debug-session"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useTabsStore } from "@/store/tabs"
import { useDebugTransport } from "@/hooks/use-debug-transport"
import { KeyValueGrid } from "./key-value-grid"

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

export function RequestBuilder() {
  const form = useDebugSessionStore((s) => s.requestForm)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)

  if (!form.triggerNodeId) {
    // TriggerSelector renders the empty-state message; we just hide here.
    return null
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex items-center gap-2">
        <select
          className="rounded-md border bg-background px-2 py-1"
          value={form.method}
          onChange={(e) => setRequestForm((c) => ({ ...c, method: e.target.value }))}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="flex-1 rounded-md border bg-background px-2 py-1 font-mono"
          value={form.path}
          onChange={(e) => setRequestForm((c) => ({ ...c, path: e.target.value }))}
        />
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">body (JSON)</span>
        <textarea
          className="h-24 rounded-md border bg-background p-2 font-mono"
          value={form.body}
          onChange={(e) => setRequestForm((c) => ({ ...c, body: e.target.value }))}
          placeholder='e.g. { "email": "a@b.com" }'
          data-testid="request-body"
        />
      </label>
      <details className="text-muted-foreground">
        <summary>headers</summary>
        <KeyValueGrid
          pairs={form.headers}
          onChange={(headers) => setRequestForm((c) => ({ ...c, headers }))}
        />
      </details>
      <details className="text-muted-foreground">
        <summary>query</summary>
        <KeyValueGrid
          pairs={form.query}
          onChange={(query) => setRequestForm((c) => ({ ...c, query }))}
        />
      </details>
      <SendButton />
    </div>
  )
}

function SendButton() {
  const form = useDebugSessionStore((s) => s.requestForm)
  const status = useDebugSessionStore((s) => s.status)
  const recordFire = useDebugSessionStore((s) => s.recordFire)
  const liveTabId = useLiveWorkflowStore((s) => s.tabId)
  const tabs = useTabsStore((s) => s.tabs)
  const workflowPath = tabs.find((t) => t.id === liveTabId)?.path ?? ""
  const { send } = useDebugTransport()
  const [jsonError, setJsonError] = useState<string | null>(null)

  const inFlight = status === "running" || status === "paused"

  const onClick = () => {
    if (!form.triggerNodeId || !workflowPath) return
    let body: unknown = undefined
    if (form.body.trim().length > 0) {
      try {
        body = JSON.parse(form.body)
      } catch (e) {
        setJsonError((e as Error).message)
        return
      }
    }
    setJsonError(null)
    const envelope: RequestEnvelope = {
      method: form.method,
      path: form.path,
      ...(body !== undefined ? { body } : {}),
      ...(form.query.length > 0
        ? { query: Object.fromEntries(form.query.filter(([k]) => k.length > 0)) }
        : {}),
      ...(form.headers.length > 0
        ? { headers: Object.fromEntries(form.headers.filter(([k]) => k.length > 0)) }
        : {}),
    }
    recordFire(workflowPath, form.triggerNodeId, envelope)
    send({
      type: "fire",
      workflowPath,
      triggerNodeId: form.triggerNodeId,
      request: envelope,
    } satisfies ClientMessage)
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={inFlight || !form.triggerNodeId}
        className="rounded-md border bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        onClick={onClick}
      >
        Send
      </button>
      {jsonError && <span className="text-red-700">{jsonError}</span>}
    </div>
  )
}
