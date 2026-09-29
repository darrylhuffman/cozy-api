import { casesPathFor, type NodeCase } from "@darrylondil/lorien-runtime/cases"
import { ChevronDown, ChevronRight, History, Play, Plus, Sparkles, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { askAi } from "@/ai/ask"
import { fixFailingCase, generateCases } from "@/ai/prompts"
import type { NodeSchemas, WorkflowFile } from "@/lib/api"
import { cn } from "@/lib/utils"
import { confirmAction } from "@/store/confirm"
import { useDebugSessionStore } from "@/store/debug-session"
import { caseKey, caseSummary, useNodeCases } from "@/store/node-cases"
import { requestIdFromName } from "@/store/request-collections"
import { type CaseDraft, draftFromCase, draftFromRun, lastRunOf, newDraft } from "./case-drafts"
import { CaseEditor } from "./case-editor"

export function NodeCasesGroup({
  nodeFile,
  uses,
  schema,
  workflow,
  workflowPath,
  highlighted,
}: {
  nodeFile: string
  uses: string
  schema: NodeSchemas | undefined
  workflow: WorkflowFile | null
  workflowPath: string
  highlighted: boolean
}) {
  const entry = useNodeCases((s) => s.byNode[nodeFile])
  const results = useNodeCases((s) => s.results)
  const running = useNodeCases((s) => s.running[casesPathFor(nodeFile)] ?? false)
  const summary = useMemo(
    () => (entry ? caseSummary({ byNode: { [nodeFile]: entry }, results }, nodeFile) : null),
    [entry, results, nodeFile],
  )
  const runs = useDebugSessionStore((s) => s.runs)
  const [open, setOpen] = useState(highlighted)
  const [editing, setEditing] = useState<{ draft: CaseDraft; replaceId: string | null } | null>(
    null,
  )

  useEffect(() => {
    if (!useNodeCases.getState().byNode[nodeFile]?.loaded)
      void useNodeCases.getState().load(nodeFile)
  }, [nodeFile])
  useEffect(() => {
    if (highlighted) setOpen(true)
  }, [highlighted])

  const cases = entry?.file.cases ?? []
  const taken = cases.map((c) => c.id)
  const lastRun = lastRunOf(runs, workflow, workflowPath, uses)
  const title = schema?.name ?? uses.split("/").pop() ?? uses

  const startNew = () => {
    setOpen(true)
    setEditing({
      draft: newDraft(requestIdFromName("case", taken), schema?.inputs),
      replaceId: null,
    })
  }
  const startFromRun = () => {
    if (!lastRun) return
    setOpen(true)
    setEditing({
      draft: draftFromRun(requestIdFromName("fromLastRun", taken), lastRun),
      replaceId: null,
    })
  }
  const save = async (c: NodeCase) => {
    // New cases take their id from the name; edits keep theirs.
    const id = editing?.replaceId ?? requestIdFromName(c.name, taken)
    await useNodeCases.getState().upsert(nodeFile, { ...c, id }, editing?.replaceId ?? undefined)
    setEditing(null)
    void useNodeCases.getState().run([nodeFile], [id])
  }
  const remove = async (c: NodeCase) => {
    const ok = await confirmAction({
      title: `Delete "${c.name}"?`,
      description: `It is removed from ${entry?.path ?? "the cases file"}.`,
      confirmLabel: "Delete",
      destructive: true,
    })
    if (ok)
      await useNodeCases
        .getState()
        .remove(nodeFile, c.id)
        .catch(() => {})
  }

  return (
    <div
      className={cn("rounded-md border", highlighted && "border-primary/60")}
      data-testid="node-cases-group"
      data-node-file={nodeFile}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-medium"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{title}</span>
          <span className="shrink-0 font-normal text-muted-foreground">
            {cases.length === 0
              ? "no cases"
              : `${cases.length} case${cases.length === 1 ? "" : "s"}`}
          </span>
        </button>
        {summary && summary.run > 0 && (
          <span
            className={cn(
              "rounded px-1.5 text-[10px] font-medium",
              summary.failed === 0
                ? "bg-green-500/15 text-green-700 dark:text-green-400"
                : "bg-red-500/15 text-red-700 dark:text-red-400",
            )}
          >
            {summary.passed}/{summary.run} passed
          </span>
        )}
        <button
          type="button"
          aria-label={`Run ${title} cases`}
          disabled={cases.length === 0 || running}
          onClick={() => void useNodeCases.getState().run([nodeFile])}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <Play className="h-3 w-3" />
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1 border-t px-2 py-1.5 text-xs">
          {entry?.error && (
            <div role="alert" className="text-red-700 dark:text-red-400">
              {entry.error}
            </div>
          )}
          <ul className="flex flex-col">
            {cases.map((c) => {
              const r = results[caseKey(casesPathFor(nodeFile), c.id)]
              const isEditing = editing?.replaceId === c.id
              return (
                <li key={c.id} className="flex flex-col">
                  <div className="group flex items-center gap-2 rounded px-1 py-0.5 hover:bg-accent/50">
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
                      className="min-w-0 flex-1 truncate text-left"
                      onClick={() =>
                        setEditing(isEditing ? null : { draft: draftFromCase(c), replaceId: c.id })
                      }
                    >
                      {c.name}
                    </button>
                    {r && (
                      <span className="text-[10px] text-muted-foreground">{r.durationMs}ms</span>
                    )}
                    <button
                      type="button"
                      aria-label={`Run ${c.name}`}
                      disabled={running}
                      onClick={() => void useNodeCases.getState().run([nodeFile], [c.id])}
                      className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
                    >
                      <Play className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${c.name}`}
                      onClick={() => void remove(c)}
                      className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {r && !r.passed && (
                    <ul
                      className="ml-4 text-[11px] text-red-700 dark:text-red-400"
                      aria-label={`${c.name} failures`}
                    >
                      {r.failures.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                      <li>
                        <button
                          type="button"
                          onClick={() => askAi(fixFailingCase({ uses, testCase: c, result: r }))}
                          className="mt-0.5 flex items-center gap-1 rounded px-1 text-violet-600 hover:bg-accent dark:text-violet-400"
                        >
                          <Sparkles className="h-3 w-3" /> Ask AI to fix
                        </button>
                      </li>
                    </ul>
                  )}
                  {isEditing && editing && (
                    <div className="my-1">
                      <CaseEditor
                        initial={editing.draft}
                        onSave={save}
                        onCancel={() => setEditing(null)}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {editing && editing.replaceId === null && (
            <CaseEditor initial={editing.draft} onSave={save} onCancel={() => setEditing(null)} />
          )}
          {!editing && (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={startNew}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent"
              >
                <Plus className="h-3 w-3" /> New case
              </button>
              <button
                type="button"
                disabled={!lastRun}
                title={
                  lastRun
                    ? `Use the input and ${lastRun.error ? "error" : "output"} from the last debug run`
                    : "Send a request from the Run tab first; its input and output for this node become the case"
                }
                onClick={startFromRun}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40"
              >
                <History className="h-3 w-3" /> From last run
              </button>
              <button
                type="button"
                onClick={() => askAi(generateCases({ uses, schema, existing: cases }))}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-violet-600 hover:bg-accent dark:text-violet-400"
              >
                <Sparkles className="h-3 w-3" /> Write with AI
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
