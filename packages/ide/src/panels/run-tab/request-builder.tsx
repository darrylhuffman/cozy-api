import { ArrowRight } from "lucide-react"
import { useMemo, useState } from "react"
import { askAi } from "@/ai/ask"
import { explainRequestFailure } from "@/ai/prompts"
import { cn } from "@/lib/utils"
import { type BodyKind, useDebugSessionStore } from "@/store/debug-session"
import { activeEnvironment, useEnvironments } from "@/store/environments"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { requestIdFromName, useRequestCollections } from "@/store/request-collections"
import { useRequestEditor } from "@/store/request-editor"
import { AssertionsEditor } from "./assertions-editor"
import { BodyEditor } from "./body-editor"
import { BodyTypeTabs } from "./body-type-tabs"
import { KeyValueGrid } from "./key-value-grid"
import { methodTone } from "./method-tone"
import { MocksEditor } from "./mocks-editor"
import { RequestResult } from "./request-result"
import { formToSavedRequest } from "./saved-request-form"
import { sendRequest } from "./send-request"

type BuilderTab = "body" | "headers" | "query" | "capture" | "mocks"

const BODY_KIND_LABEL: Record<BodyKind, string> = {
  json: "JSON",
  xml: "XML",
  text: "Text",
  form: "Form",
  none: "none",
}

export function RequestBuilder({ workflowPath }: { workflowPath: string }) {
  const form = useDebugSessionStore((s) => s.requestForm)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)
  const name = useRequestEditor((s) => s.name)
  const editingId = useRequestEditor((s) => s.editingId)
  const expect = useRequestEditor((s) => s.expect)
  const capture = useRequestEditor((s) => s.capture)
  const mocks = useRequestEditor((s) => s.mocks)
  const nodeIds = useWorkflowNodeIds()
  const lastResult = useRequestEditor((s) => s.lastResult)

  const actions = useRequestActions(workflowPath)
  const [tab, setTab] = useState<BuilderTab>("body")

  if (!form.triggerNodeId) {
    return null
  }

  const tabs: Array<{ id: BuilderTab; label: string; hint: string }> = [
    { id: "body", label: "Body", hint: BODY_KIND_LABEL[form.bodyKind] },
    { id: "headers", label: "Headers", hint: String(form.headers.length) },
    { id: "query", label: "Query", hint: String(form.query.length) },
    { id: "capture", label: "Capture", hint: String(capture.length) },
    { id: "mocks", label: "Mocks", hint: String(mocks.length) },
  ]

  return (
    <div className="flex flex-col gap-2.5 text-[13px]" data-testid="request-builder">
      <div className="flex min-w-0 items-center gap-2">
        <input
          aria-label="Request name"
          placeholder={editingId ? "Request name" : "Untitled request"}
          value={name}
          onChange={(e) => useRequestEditor.getState().setName(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold placeholder:font-medium placeholder:text-muted-foreground hover:border-border focus:border-border focus:outline-none"
        />
        {editingId && (
          <button
            type="button"
            disabled={actions.saving}
            className="h-6 shrink-0 whitespace-nowrap rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            onClick={() => void actions.save(true)}
          >
            Save as new
          </button>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          data-testid="request-method"
          className={cn(
            "flex h-8 shrink-0 items-center rounded-md border border-border bg-muted/50 px-2 font-mono text-xs font-medium",
            methodTone(form.method),
          )}
        >
          {form.method}
        </span>
        <input
          type="text"
          aria-label="Request path"
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          value={form.path}
          onChange={(e) => setRequestForm((c) => ({ ...c, path: e.target.value }))}
        />
        <button
          type="button"
          disabled={actions.sending}
          className="flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          onClick={() => void actions.send()}
        >
          <ArrowRight className="size-3.5" />
          {actions.sending ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          disabled={actions.saving}
          className="h-8 shrink-0 whitespace-nowrap rounded-md border border-border px-2.5 text-xs hover:bg-accent disabled:opacity-50"
          onClick={() => void actions.save(false)}
        >
          {actions.saving ? "Saving…" : "Save"}
        </button>
      </div>
      {actions.problem && (
        <div role="alert" className="text-xs text-destructive">
          {actions.problem}
        </div>
      )}
      <div>
        <div
          role="tablist"
          aria-label="Request parts"
          className="flex overflow-x-auto border-b border-border text-xs"
        >
          {tabs.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={cn(
                  "-mb-px flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-2 py-1.5",
                  active
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                <span className="font-normal text-muted-foreground">{t.hint}</span>
              </button>
            )
          })}
        </div>
        <div role="tabpanel" className="flex flex-col gap-2 pt-2">
          {tab === "body" && (
            <>
              <BodyTypeTabs />
              <BodyEditor />
            </>
          )}
          {tab === "headers" && (
            <KeyValueGrid
              pairs={form.headers}
              onChange={(headers) => setRequestForm((c) => ({ ...c, headers }))}
            />
          )}
          {tab === "query" && (
            <KeyValueGrid
              pairs={form.query}
              onChange={(query) => setRequestForm((c) => ({ ...c, query }))}
            />
          )}
          {tab === "capture" && (
            <>
              <div className="text-[11px] text-muted-foreground">
                Save values for later requests. Variable name, then where to read it:{" "}
                <code className="font-mono">body.user.id</code>,{" "}
                <code className="font-mono">header.location</code> or{" "}
                <code className="font-mono">status</code>.
              </div>
              <KeyValueGrid
                pairs={capture}
                onChange={(next) => useRequestEditor.getState().setCapture(next)}
              />
            </>
          )}
          {tab === "mocks" && (
            <MocksEditor
              value={mocks}
              nodeIds={nodeIds.mockable}
              onChange={(next) => useRequestEditor.getState().setMocks(next)}
            />
          )}
        </div>
      </div>
      <section className="flex flex-col gap-1.5" aria-label="Checks">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Checks {expect.length}
        </div>
        <AssertionsEditor
          value={expect}
          nodeIds={nodeIds.all}
          onChange={(next) => useRequestEditor.getState().setExpect(next)}
        />
      </section>
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

/** The live workflow's node ids: all of them, and the ones a mock can stand in for. */
function useWorkflowNodeIds(): { all: string[]; mockable: string[] } {
  const key = useLiveWorkflowStore((s) =>
    Object.entries(s.workflow?.nodes ?? {})
      .map(([id, n]) => `${n.uses.startsWith("@core/") ? "-" : "+"}${id}`)
      .join("\n"),
  )
  return useMemo(() => {
    const entries = key ? key.split("\n") : []
    return {
      all: entries.map((e) => e.slice(1)),
      mockable: entries.filter((e) => e.startsWith("+")).map((e) => e.slice(1)),
    }
  }, [key])
}

/** Send / save for the form in the builder, plus the last validation or save problem. */
function useRequestActions(workflowPath: string) {
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
      mocks: ed.mocks,
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
      ed.open({ id, name, expect: ed.expect, capture: ed.capture, mocks: ed.mocks })
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

  return { editingId, sending, saving, problem, send, save }
}
