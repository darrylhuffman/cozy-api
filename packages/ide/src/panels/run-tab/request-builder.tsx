import { useState } from "react"
import type { RequestEnvelope } from "@darrylondil/lorien-runtime"
import { useDebugSessionStore } from "@/store/debug-session"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useTabsStore } from "@/store/tabs"
import { useRequestHistoryStore } from "@/store/request-history"
import { restBase } from "@/lib/api"
import { BodyTypeTabs } from "./body-type-tabs"
import { BodyEditor } from "./body-editor"
import { KeyValueGrid } from "./key-value-grid"
import { serializeBody } from "./serialize-body"

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

export function RequestBuilder() {
  const form = useDebugSessionStore((s) => s.requestForm)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)

  if (!form.triggerNodeId) {
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
      <BodyTypeTabs />
      <BodyEditor />
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
  const liveTabId = useLiveWorkflowStore((s) => s.tabId)
  const tabs = useTabsStore((s) => s.tabs)
  const workflowPath = tabs.find((t) => t.id === liveTabId)?.path ?? ""
  const addEntry = useRequestHistoryStore((s) => s.addEntry)
  const setResponse = useRequestHistoryStore((s) => s.setResponse)
  const setError = useRequestHistoryStore((s) => s.setError)
  const [bodyError, setBodyError] = useState<string | null>(null)

  const onClick = async () => {
    if (!form.triggerNodeId || !workflowPath) return
    const r = serializeBody(form)
    if (r.error !== undefined) {
      setBodyError(r.error)
      return
    }
    setBodyError(null)

    const envelope: RequestEnvelope = {
      method: form.method,
      path: form.path,
      ...(r.body !== undefined ? { body: r.body } : {}),
      ...(form.query.length > 0
        ? { query: Object.fromEntries(form.query.filter(([k]) => k.length > 0)) }
        : {}),
      ...(form.headers.length > 0
        ? { headers: Object.fromEntries(form.headers.filter(([k]) => k.length > 0)) }
        : {}),
    }

    // Build absolute URL using restBase() + path
    const url = new URL(`${restBase()}${form.path}`)
    for (const [k, v] of form.query) {
      if (k.length > 0) url.searchParams.set(k, v)
    }

    // Headers
    const headers: Record<string, string> = {}
    for (const [k, v] of form.headers) {
      if (k.length > 0) headers[k] = v
    }

    // Body init: stringify if object, raw string otherwise
    let bodyInit: BodyInit | undefined
    if (r.body !== undefined) {
      bodyInit =
        typeof r.body === "string" ? r.body : JSON.stringify(r.body)
      if (
        typeof r.body !== "string" &&
        !Object.keys(headers).some(
          (k) => k.toLowerCase() === "content-type",
        )
      ) {
        headers["Content-Type"] = "application/json"
      }
    }

    const id = addEntry({
      workflowPath,
      triggerNodeId: form.triggerNodeId,
      request: envelope,
      startedAt: Date.now(),
    })

    try {
      const startedAt = Date.now()
      const res = await fetch(url.toString(), {
        method: form.method,
        headers,
        ...(bodyInit !== undefined ? { body: bodyInit } : {}),
      })
      const responseHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => {
        responseHeaders[k] = v
      })
      const text = await res.text()
      let body: unknown = text
      const ct = res.headers.get("content-type") ?? ""
      if (ct.includes("application/json")) {
        try {
          body = JSON.parse(text)
        } catch {
          /* keep as text */
        }
      }
      setResponse(id, {
        status: res.status,
        headers: responseHeaders,
        body,
        durationMs: Date.now() - startedAt,
      })
    } catch (e) {
      setError(id, (e as Error).message)
    }
  }

  // Send is disabled when no trigger is picked. Multiple concurrent requests
  // are now supported (no in-flight gate).
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={!form.triggerNodeId}
        className="rounded-md border bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        onClick={() => void onClick()}
      >
        Send
      </button>
      {bodyError && <span className="text-red-700">{bodyError}</span>}
    </div>
  )
}
