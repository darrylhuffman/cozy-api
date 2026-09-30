import type { RequestRunResult, SavedRequest } from "@darrylondil/lorien-runtime/requests"
import { Play, Plus, Sparkles, Trash2 } from "lucide-react"
import { useState } from "react"
import { askAi } from "@/ai/ask"
import { generateRequests } from "@/ai/prompts"
import { cn } from "@/lib/utils"
import { confirmAction } from "@/store/confirm"
import { useDebugSessionStore } from "@/store/debug-session"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { resultKey, useRequestCollections } from "@/store/request-collections"
import { useRequestEditor } from "@/store/request-editor"
import { useSchemasStore } from "@/store/schemas"
import { methodTone } from "./method-tone"
import { runAllSaved, runSaved, useCollection } from "./run-saved"
import { mocksToRows, savedRequestToForm } from "./saved-request-form"

/**
 * Row actions collapse to zero width until the row is hovered or focused, so
 * the status · duration column sits flush right the rest of the time. They
 * stay in the tab order (never display:none) and expand on keyboard focus.
 */
const REVEAL =
  "w-0 overflow-hidden p-0 opacity-0 group-hover:w-auto group-hover:p-1 group-hover:opacity-100 group-has-[:focus-visible]:w-auto group-has-[:focus-visible]:p-1 group-has-[:focus-visible]:opacity-100"

/** Loads a saved request into the builder below. */
export function openSavedRequest(req: SavedRequest) {
  const trigger = useDebugSessionStore.getState().requestForm.triggerNodeId
  useDebugSessionStore.getState().setRequestForm(() => savedRequestToForm(req, trigger))
  useRequestEditor.getState().open({
    id: req.id,
    name: req.name,
    expect: req.expect ?? [],
    capture: Object.entries(req.capture ?? {}),
    mocks: mocksToRows(req.mocks),
  })
}

export function SavedRequests({ workflowPath }: { workflowPath: string }) {
  const entry = useCollection(workflowPath)
  const results = useRequestCollections((s) => s.results)
  const editingId = useRequestEditor((s) => s.editingId)
  const [runningAll, setRunningAll] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)

  const requests = entry?.collection.requests ?? []
  const ran = requests
    .map((r) => results[resultKey(workflowPath, r.id)])
    .filter(Boolean) as RequestRunResult[]
  const passed = ran.filter((r) => r.passed).length

  const runOne = async (req: SavedRequest) => {
    // Load it into the builder below so its result shows there as it arrives.
    openSavedRequest(req)
    setRunningId(req.id)
    try {
      await runSaved(workflowPath, req)
    } finally {
      setRunningId(null)
    }
  }

  const runAll = async () => {
    setRunningAll(true)
    try {
      await runAllSaved(workflowPath, requests)
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

  const allPassed = passed === ran.length

  return (
    <div className="flex flex-col gap-1 text-[13px]" data-testid="saved-requests">
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="min-w-0 truncate whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Saved requests
        </div>
        {ran.length > 0 && (
          <span
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full px-1.5 py-px text-[11px] font-medium",
              allPassed ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
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
          className="flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs text-success hover:bg-accent disabled:opacity-40"
        >
          <Play className="size-3 fill-current" />
          {runningAll ? "Running…" : "Run all"}
        </button>
        <button
          type="button"
          onClick={() =>
            useRequestEditor.getState().open({ id: null, name: "", expect: [], capture: [] })
          }
          className="flex h-6 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
          New
        </button>
        <button
          type="button"
          aria-label="Write with AI"
          title="Write with AI: have Claude write requests for this workflow"
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
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-ai hover:bg-ai/15"
        >
          <Sparkles className="size-3.5" />
        </button>
      </div>
      {entry?.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive"
        >
          {entry.error}
        </div>
      )}
      {entry?.loaded && requests.length === 0 && !entry.error && (
        <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          Nothing saved for this workflow yet. Build a request below and press Save; it is written
          to <code className="font-mono">{entry.path}</code> so the whole team gets it.
        </div>
      )}
      <ul className="flex flex-col gap-px">
        {requests.map((req) => {
          const r = results[resultKey(workflowPath, req.id)]
          const selected = editingId === req.id
          return (
            <li
              key={req.id}
              className={cn(
                "group flex h-8 min-w-0 items-center gap-2 rounded-md px-2",
                selected ? "bg-primary/10 ring-1 ring-primary/50 ring-inset" : "hover:bg-accent/60",
              )}
            >
              <span
                role="img"
                aria-label={r ? (r.passed ? "passed" : "failed") : "not run"}
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  !r
                    ? "border border-muted-foreground/50"
                    : r.passed
                      ? "bg-success"
                      : "bg-destructive",
                )}
              />
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => openSavedRequest(req)}
              >
                <span
                  className={cn("w-9 shrink-0 font-mono text-[10.5px]", methodTone(req.method))}
                >
                  {req.method}
                </span>
                <span className="truncate">{req.name}</span>
              </button>
              {r?.response && (
                <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground group-hover:hidden group-has-[:focus-visible]:hidden">
                  {r.response.status} · {r.response.durationMs}ms
                </span>
              )}
              <button
                type="button"
                aria-label={`Run ${req.name}`}
                disabled={runningId === req.id || runningAll}
                onClick={() => void runOne(req)}
                className={cn(
                  "shrink-0 rounded text-success hover:bg-background disabled:opacity-40",
                  r?.response ? REVEAL : "p-1",
                )}
              >
                <Play className="size-3 fill-current" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${req.name}`}
                onClick={() => void remove(req)}
                className={cn(
                  "shrink-0 rounded text-muted-foreground hover:bg-background hover:text-destructive",
                  REVEAL,
                )}
              >
                <Trash2 className="size-3" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
