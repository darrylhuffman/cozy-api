import type { SavedRequest } from "@darrylondil/lorien-runtime/requests"
import { Play } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { methodTone } from "@/panels/run-tab/method-tone"
import { failureLines, runAllSaved, runSaved, useCollection } from "@/panels/run-tab/run-saved"
import { openSavedRequest } from "@/panels/run-tab/saved-requests"
import { useInspectorTab } from "@/store/inspector-tab"
import { resultKey, useRequestCollections } from "@/store/request-collections"
import { useRequestEditor } from "@/store/request-editor"

/** "2 mocked · 3 step checks", or "" for a plain request test. */
export function testTags(req: SavedRequest): string {
  const mocks = Object.keys(req.mocks ?? {}).length
  const steps = (req.expect ?? []).filter((a) => a.target === "node").length
  return [
    mocks > 0 ? `${mocks} mocked` : "",
    steps > 0 ? `${steps} step check${steps === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(" · ")
}

/**
 * The workflow's saved requests, run as end-to-end tests: each sends a request
 * through the whole workflow and checks the response, and can mock nodes or
 * check what a step received and returned. They're edited in the Run tab.
 */
export function WorkflowTests({ workflowPath }: { workflowPath: string }) {
  const entry = useCollection(workflowPath)
  const results = useRequestCollections((s) => s.results)
  const [runningAll, setRunningAll] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const requests = entry?.collection.requests ?? []
  const ran = requests.map((r) => results[resultKey(workflowPath, r.id)]).filter(Boolean)
  const passed = ran.filter((r) => r?.passed).length

  const runOne = async (req: SavedRequest) => {
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
  const edit = (req: SavedRequest) => {
    // Bind first: the Run tab clears the editor when it mounts for another workflow.
    useRequestEditor.getState().bindWorkflow(workflowPath)
    openSavedRequest(req)
    useInspectorTab.getState().setTab("run")
  }

  return (
    <section
      className="flex flex-col gap-2"
      aria-label="Workflow tests"
      data-testid="workflow-tests"
    >
      <div className="flex items-center gap-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Workflow tests
        </div>
        {ran.length > 0 && (
          <span
            className={cn(
              "rounded-full px-2 py-px text-[11px] font-medium",
              passed === ran.length
                ? "bg-success/15 text-success"
                : "bg-destructive/15 text-destructive",
            )}
          >
            {passed}/{ran.length} passed
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Run all workflow tests"
          disabled={requests.length === 0 || runningAll}
          onClick={() => void runAll()}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40"
        >
          <Play className="h-3 w-3" />
          {runningAll ? "Running…" : "Run all"}
        </button>
      </div>
      {entry?.error && (
        <div role="alert" className="text-destructive">
          {entry.error}
        </div>
      )}
      {entry?.loaded && requests.length === 0 && !entry.error ? (
        <div className="rounded-md border border-dashed p-2 text-muted-foreground">
          No workflow tests yet. Save a request in the Run tab and it runs here, in CI with{" "}
          <code>lorien test</code>.
        </div>
      ) : (
        <ul className="flex flex-col rounded-lg border border-border bg-card px-1.5 py-1 text-[13px]">
          {requests.map((req) => {
            const r = results[resultKey(workflowPath, req.id)]
            const tags = testTags(req)
            const failures = r ? failureLines(r) : []
            return (
              <li key={req.id} className="flex flex-col" data-testid="workflow-test">
                <div className="flex items-center gap-2 rounded px-1 py-1 hover:bg-accent/50">
                  <span
                    role="img"
                    aria-label={r ? (r.passed ? "passed" : "failed") : "not run"}
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      !r
                        ? "border border-muted-foreground/50"
                        : r.passed
                          ? "bg-success"
                          : "bg-destructive",
                    )}
                  />
                  <button
                    type="button"
                    title="Edit in the Run tab"
                    onClick={() => edit(req)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className={cn(
                        "w-9 shrink-0 self-start pt-0.5 font-mono text-[10.5px]",
                        methodTone(req.method),
                      )}
                    >
                      {req.method}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{req.name}</span>
                      {tags && (
                        <span className="truncate text-[11px] text-muted-foreground">{tags}</span>
                      )}
                    </span>
                  </button>
                  {r?.response && (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {r.response.status} · {r.response.durationMs}ms
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Run ${req.name}`}
                    disabled={runningAll || runningId === req.id}
                    onClick={() => void runOne(req)}
                    className="rounded p-0.5 text-success hover:bg-background disabled:opacity-40"
                  >
                    <Play className="h-3 w-3" />
                  </button>
                </div>
                {failures.length > 0 && (
                  <ul
                    className="mb-1 ml-5 text-[11px] text-destructive"
                    aria-label={`${req.name} failures`}
                  >
                    {failures.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
