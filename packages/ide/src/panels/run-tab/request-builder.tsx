import { useState } from "react"
import { askAi } from "@/ai/ask"
import { explainRequestFailure } from "@/ai/prompts"
import { useDebugSessionStore } from "@/store/debug-session"
import { activeEnvironment, useEnvironments } from "@/store/environments"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { requestIdFromName, useRequestCollections } from "@/store/request-collections"
import { useRequestEditor } from "@/store/request-editor"
import { AssertionsEditor } from "./assertions-editor"
import { BodyEditor } from "./body-editor"
import { BodyTypeTabs } from "./body-type-tabs"
import { KeyValueGrid } from "./key-value-grid"
import { RequestResult } from "./request-result"
import { formToSavedRequest } from "./saved-request-form"
import { sendRequest } from "./send-request"

export function RequestBuilder({ workflowPath }: { workflowPath: string }) {
  const form = useDebugSessionStore((s) => s.requestForm)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)
  const name = useRequestEditor((s) => s.name)
  const editingId = useRequestEditor((s) => s.editingId)
  const expect = useRequestEditor((s) => s.expect)
  const capture = useRequestEditor((s) => s.capture)
  const lastResult = useRequestEditor((s) => s.lastResult)

  if (!form.triggerNodeId) {
    return null
  }

  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="request-builder">
      <input
        aria-label="Request name"
        placeholder={editingId ? "Request name" : "Untitled request"}
        value={name}
        onChange={(e) => useRequestEditor.getState().setName(e.target.value)}
        className="rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium hover:border-border focus:border-border focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <span
          data-testid="request-method"
          className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-muted-foreground"
        >
          {form.method}
        </span>
        <input
          type="text"
          aria-label="Request path"
          className="flex-1 rounded-md border bg-background px-2 py-1 font-mono"
          value={form.path}
          onChange={(e) => setRequestForm((c) => ({ ...c, path: e.target.value }))}
        />
      </div>
      <BodyTypeTabs />
      <BodyEditor />
      <details className="text-muted-foreground">
        <summary>headers{form.headers.length > 0 ? ` (${form.headers.length})` : ""}</summary>
        <KeyValueGrid
          pairs={form.headers}
          onChange={(headers) => setRequestForm((c) => ({ ...c, headers }))}
        />
      </details>
      <details className="text-muted-foreground">
        <summary>query{form.query.length > 0 ? ` (${form.query.length})` : ""}</summary>
        <KeyValueGrid
          pairs={form.query}
          onChange={(query) => setRequestForm((c) => ({ ...c, query }))}
        />
      </details>
      <details open={expect.length > 0 || undefined}>
        <summary className="text-muted-foreground">
          checks{expect.length > 0 ? ` (${expect.length})` : ""}
        </summary>
        <div className="mt-1">
          <AssertionsEditor
            value={expect}
            onChange={(next) => useRequestEditor.getState().setExpect(next)}
          />
        </div>
      </details>
      <details className="text-muted-foreground" open={capture.length > 0 || undefined}>
        <summary>
          capture for later requests{capture.length > 0 ? ` (${capture.length})` : ""}
        </summary>
        <div className="mt-1 text-[11px]">
          Variable name, then where to read it: <code>body.user.id</code>,{" "}
          <code>header.location</code> or <code>status</code>.
        </div>
        <KeyValueGrid
          pairs={capture}
          onChange={(next) => useRequestEditor.getState().setCapture(next)}
        />
      </details>
      <ActionRow workflowPath={workflowPath} />
      {lastResult && (
        <RequestResult
          result={lastResult}
          onAddChecks={(checks) => useRequestEditor.getState().setExpect([...expect, ...checks])}
          onAskAi={() =>
            askAi(
              explainRequestFailure({
                workflowPath,
                workflow: useLiveWorkflowStore.getState().workflow,
                result: lastResult,
              }),
            )
          }
        />
      )}
    </div>
  )
}

function ActionRow({ workflowPath }: { workflowPath: string }) {
  const editingId = useRequestEditor((s) => s.editingId)
  const sending = useRequestEditor((s) => s.sending)
  const saving = useRequestCollections((s) => s.byWorkflow[workflowPath]?.saving ?? false)
  const [problem, setProblem] = useState<string | null>(null)

  const build = (id: string) => {
    const form = useDebugSessionStore.getState().requestForm
    const ed = useRequestEditor.getState()
    const r = formToSavedRequest(form, {
      id,
      name: ed.name,
      expect: ed.expect,
      capture: ed.capture,
    })
    if (r.error !== undefined) {
      setProblem(r.error)
      return null
    }
    setProblem(null)
    return r.request
  }

  const send = async () => {
    const req = build(editingId ?? "scratch")
    if (!req) return
    const ed = useRequestEditor.getState()
    ed.setSending(true)
    try {
      const vars = activeEnvironment(useEnvironments.getState()).vars
      const result = await sendRequest(req, { workflowPath, vars })
      ed.setLastResult(result)
      if (editingId) useRequestCollections.getState().setResult(workflowPath, editingId, result)
    } finally {
      ed.setSending(false)
    }
  }

  const save = async (asNew: boolean) => {
    const existing =
      useRequestCollections.getState().byWorkflow[workflowPath]?.collection.requests ?? []
    const ed = useRequestEditor.getState()
    const form = useDebugSessionStore.getState().requestForm
    const name = ed.name.trim() || `${form.method} ${form.path}`
    const id =
      editingId && !asNew
        ? editingId
        : requestIdFromName(
            name,
            existing.map((r) => r.id),
          )
    const req = build(id)
    if (!req) return
    try {
      await useRequestCollections.getState().upsert(workflowPath, { ...req, name })
      const last = ed.lastResult
      ed.open({ id, name, expect: ed.expect, capture: ed.capture })
      if (last) {
        ed.setLastResult(last)
        useRequestCollections
          .getState()
          .setResult(workflowPath, id, { ...last, requestId: id, name })
      }
    } catch (e) {
      setProblem((e as Error).message)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={sending}
        className="rounded-md border bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        onClick={() => void send()}
      >
        {sending ? "Sending…" : "Send"}
      </button>
      <button
        type="button"
        disabled={saving}
        className="rounded-md border px-3 py-1 hover:bg-accent disabled:opacity-50"
        onClick={() => void save(false)}
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {editingId && (
        <button
          type="button"
          disabled={saving}
          className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          onClick={() => void save(true)}
        >
          Save as new
        </button>
      )}
      {problem && (
        <span role="alert" className="text-red-700 dark:text-red-400">
          {problem}
        </span>
      )}
    </div>
  )
}
