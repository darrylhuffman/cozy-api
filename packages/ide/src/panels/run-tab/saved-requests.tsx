import type { RequestRunResult, SavedRequest } from "@darrylondil/lorien-runtime/requests"
import { Play, Plus, Sparkles, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { askAi } from "@/ai/ask"
import { generateRequests } from "@/ai/prompts"
import { subscribeToFileEvents } from "@/lib/events"
import { cn } from "@/lib/utils"
import { confirmAction } from "@/store/confirm"
import { useDebugSessionStore } from "@/store/debug-session"
import { activeEnvironment, useEnvironments } from "@/store/environments"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { resultKey, useRequestCollections } from "@/store/request-collections"
import { useRequestEditor } from "@/store/request-editor"
import { useSchemasStore } from "@/store/schemas"
import { savedRequestToForm } from "./saved-request-form"
import { sendAll, sendRequest } from "./send-request"

function currentVars() {
  return activeEnvironment(useEnvironments.getState()).vars
}

/** Loads a saved request into the builder below. */
export function openSavedRequest(req: SavedRequest) {
  const trigger = useDebugSessionStore.getState().requestForm.triggerNodeId
  useDebugSessionStore.getState().setRequestForm(() => savedRequestToForm(req, trigger))
  useRequestEditor.getState().open({
    id: req.id,
    name: req.name,
    expect: req.expect ?? [],
    capture: Object.entries(req.capture ?? {}),
  })
}

export function SavedRequests({ workflowPath }: { workflowPath: string }) {
  const entry = useRequestCollections((s) => s.byWorkflow[workflowPath])
  const results = useRequestCollections((s) => s.results)
  const editingId = useRequestEditor((s) => s.editingId)
  const [runningAll, setRunningAll] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)

  useEffect(() => {
    const store = useRequestCollections.getState()
    if (!store.byWorkflow[workflowPath]?.loaded) void store.load(workflowPath)
    const collectionPath = workflowPath.replace(/\.workflow$/, ".requests.json")
    return subscribeToFileEvents((e) => {
      if (e.path !== collectionPath) return
      // Our own saves echo back as change events; only reload for outside edits.
      if (useRequestCollections.getState().byWorkflow[workflowPath]?.saving) return
      void useRequestCollections.getState().load(workflowPath)
    })
  }, [workflowPath])

  const requests = entry?.collection.requests ?? []
  const ran = requests
    .map((r) => results[resultKey(workflowPath, r.id)])
    .filter(Boolean) as RequestRunResult[]
  const passed = ran.filter((r) => r.passed).length

  const runOne = async (req: SavedRequest) => {
    setRunningId(req.id)
    try {
      const r = await sendRequest(req, { workflowPath, vars: currentVars() })
      useRequestCollections.getState().setResult(workflowPath, req.id, r)
      if (useRequestEditor.getState().editingId === req.id)
        useRequestEditor.getState().setLastResult(r)
    } finally {
      setRunningId(null)
    }
  }

  const runAll = async () => {
    setRunningAll(true)
    try {
      await sendAll(requests, {
        workflowPath,
        vars: currentVars(),
        onResult: (r) => {
          useRequestCollections.getState().setResult(workflowPath, r.requestId, r)
          if (useRequestEditor.getState().editingId === r.requestId)
            useRequestEditor.getState().setLastResult(r)
        },
      })
    } finally {
      setRunningAll(false)
    }
  }

  const remove = async (req: SavedRequest) => {
    const ok = await confirmAction({
      title: `Delete "${req.name}"?`,
      description: `It is removed from ${entry?.path ?? "the collection"} for everyone once committed.`,
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    await useRequestCollections
      .getState()
      .remove(workflowPath, req.id)
      .catch(() => {})
    if (useRequestEditor.getState().editingId === req.id)
      useRequestEditor.getState().open({ id: null, name: "", expect: [], capture: [] })
  }

  return (
    <div className="flex flex-col gap-1 text-xs" data-testid="saved-requests">
      <div className="flex items-center gap-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Saved requests
        </div>
        {ran.length > 0 && (
          <span
            className={cn(
              "rounded px-1.5 text-[10px] font-medium",
              passed === ran.length
                ? "bg-green-500/15 text-green-700 dark:text-green-400"
                : "bg-red-500/15 text-red-700 dark:text-red-400",
            )}
          >
            {passed}/{ran.length} passed
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          disabled={requests.length === 0 || runningAll}
          onClick={() => void runAll()}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40"
        >
          <Play className="h-3 w-3" />
          {runningAll ? "Running…" : "Run all"}
        </button>
        <button
          type="button"
          onClick={() =>
            useRequestEditor.getState().open({ id: null, name: "", expect: [], capture: [] })
          }
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent"
        >
          <Plus className="h-3 w-3" />
          New
        </button>
        <button
          type="button"
          title="Have Claude write requests for this workflow"
          onClick={() =>
            askAi(
              generateRequests({
                workflowPath,
                workflow: useLiveWorkflowStore.getState().workflow,
                existing: requests,
                schemas: useSchemasStore.getState().schemas,
              }),
            )
          }
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-violet-600 hover:bg-accent dark:text-violet-400"
        >
          <Sparkles className="h-3 w-3" />
          Write with AI
        </button>
      </div>
      {entry?.error && (
        <div
          role="alert"
          className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-red-700 dark:text-red-400"
        >
          {entry.error}
        </div>
      )}
      {entry?.loaded && requests.length === 0 && !entry.error && (
        <div className="rounded-md border border-dashed p-2 text-muted-foreground">
          Nothing saved for this workflow yet. Build a request below and press Save; it is written
          to <code className="font-mono">{entry.path}</code> so the whole team gets it.
        </div>
      )}
      <ul className="flex flex-col">
        {requests.map((req) => {
          const r = results[resultKey(workflowPath, req.id)]
          return (
            <li
              key={req.id}
              className={cn(
                "group flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent/50",
                editingId === req.id && "bg-accent",
              )}
            >
              <span
                role="img"
                aria-label={r ? (r.passed ? "passed" : "failed") : "not run"}
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  !r
                    ? "border border-muted-foreground/50"
                    : r.passed
                      ? "bg-green-500"
                      : "bg-red-500",
                )}
              />
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => openSavedRequest(req)}
              >
                <span className="w-12 shrink-0 font-mono text-[10px] text-muted-foreground">
                  {req.method}
                </span>
                <span className="truncate">{req.name}</span>
              </button>
              {r?.response && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {r.response.status} · {r.response.durationMs}ms
                </span>
              )}
              <button
                type="button"
                aria-label={`Run ${req.name}`}
                disabled={runningId === req.id || runningAll}
                onClick={() => void runOne(req)}
                className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
              >
                <Play className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${req.name}`}
                onClick={() => void remove(req)}
                className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
