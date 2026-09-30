import { DiffEditor } from "@monaco-editor/react"
import { ReactFlowProvider } from "@xyflow/react"
import { Check, FileCode, GitMerge } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { languageFor } from "@/code/code-editor"
import { fetchGitFile, parseWorkflowContent, type WorkflowFile } from "@/lib/api"
import { defineMonacoThemes, monacoThemeName } from "@/lib/monaco-theme"
import { openCodeFile } from "@/lib/open-code-file"
import { cn } from "@/lib/utils"
import { useGitStore } from "@/store/git"
import { useActiveTheme } from "@/store/theme"
import { serializeWorkflow } from "@/store/workflow-drafts"
import { formatValue } from "@/workflow/value-chip"
import { diffWorkflows } from "@/workflow/workflow-diff"
import { type MergeSide, mergeWorkflows, type WorkflowConflict } from "@/workflow/workflow-merge"
import { WorkflowDiffCanvas } from "./workflow-diff-canvas"

interface Sides {
  base: string | null
  ours: string | null
  theirs: string | null
  worktree: string | null
}

function parse(path: string, text: string | null): WorkflowFile | null {
  if (text === null) return null
  try {
    return parseWorkflowContent(path, text)
  } catch {
    return null
  }
}

/**
 * A file a merge couldn't combine. Workflows merge node by node: changes to
 * different nodes and inputs combine on their own, and each clash is picked
 * from ours or theirs, with the result drawn as a graph. Other files show
 * both sides; take one, or fix the file by hand and mark it resolved.
 */
export function ConflictView({ path }: { path: string }) {
  const [sides, setSides] = useState<Sides | null>(null)
  const [error, setError] = useState<string | null>(null)
  const status = useGitStore((s) => s.status)
  const conflict = status?.repo ? status.conflicts.find((c) => c.path === path) : undefined
  const merging = status?.repo ? status.merging : null

  useEffect(() => {
    let alive = true
    Promise.all((["base", "ours", "theirs", "worktree"] as const).map((r) => fetchGitFile(path, r)))
      .then(([base, ours, theirs, worktree]) => {
        if (alive) setSides({ base: base!, ours: ours!, theirs: theirs!, worktree: worktree! })
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [path])

  const name = path.split("/").pop() ?? path
  const header = (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-[12.5px]">
      <GitMerge aria-hidden className="size-4 text-destructive" />
      <span className="font-semibold">{name}</span>
      <span className="text-[11.5px] text-muted-foreground">
        {merging?.branch ? `merging ${merging.branch} into the current branch` : "merge conflict"}
      </span>
    </div>
  )

  if (error) return <div className="p-4 text-sm text-destructive">{error}</div>
  if (!sides) return <div className="p-4 text-sm text-muted-foreground">Loading {path}…</div>
  if (!conflict) {
    return (
      <div className="flex h-full flex-col" data-testid="conflict-view">
        {header}
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Check className="size-4 text-success" /> Resolved. Commit the merge from Source Control.
        </div>
      </div>
    )
  }

  const ours = parse(path, sides.ours)
  const theirs = parse(path, sides.theirs)
  const visual = path.endsWith(".workflow") && ours && theirs
  return (
    <div className="flex h-full flex-col" data-testid="conflict-view">
      {header}
      {visual ? (
        <WorkflowMergeView path={path} base={parse(path, sides.base)} ours={ours} theirs={theirs} />
      ) : (
        <TextConflict path={path} sides={sides} />
      )}
    </div>
  )
}

function WorkflowMergeView({
  path,
  base,
  ours,
  theirs,
}: {
  path: string
  base: WorkflowFile | null
  ours: WorkflowFile
  theirs: WorkflowFile
}) {
  const [choices, setChoices] = useState<Record<string, MergeSide>>({})
  const busy = useGitStore((s) => s.busy)
  const result = useMemo(
    () => mergeWorkflows(base, ours, theirs, choices),
    [base, ours, theirs, choices],
  )
  const diff = useMemo(() => diffWorkflows(ours, result.merged), [ours, result.merged])
  const fromTheirs = diff.changes.length

  const save = () =>
    void useGitStore.getState().resolve(path, { content: serializeWorkflow(result.merged) })

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1">
        <div className="flex h-8 items-center border-b border-border px-3 text-[11.5px] text-muted-foreground">
          The merged workflow, marked against ours: {fromTheirs}{" "}
          {fromTheirs === 1 ? "change comes" : "changes come"} from theirs.
        </div>
        <div className="h-[calc(100%-2rem)]">
          <ReactFlowProvider>
            <WorkflowDiffCanvas
              before={ours}
              after={result.merged}
              diff={diff}
              filters={{ added: true, changed: true, removed: true }}
              focusId={null}
            />
          </ReactFlowProvider>
        </div>
      </div>
      <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-card">
        <div className="border-b border-border px-3 py-2.5 text-[12.5px]">
          {result.conflicts.length === 0 ? (
            <span>Both sides combine without a clash.</span>
          ) : (
            <span>
              <strong>
                {result.conflicts.length} {result.conflicts.length === 1 ? "node" : "nodes"}
              </strong>{" "}
              changed on both sides. Pick which version each keeps.
            </span>
          )}
          {result.combined.length > 0 && (
            <div className="mt-1 text-[11.5px] text-muted-foreground">
              Combined automatically: {result.combined.join(", ")}
            </div>
          )}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Conflicts">
          {result.conflicts.map((c) => (
            <ConflictCard
              key={c.nodeId}
              conflict={c}
              choice={choices[c.nodeId] ?? "ours"}
              onChoose={(side) => setChoices((cur) => ({ ...cur, [c.nodeId]: side }))}
            />
          ))}
        </ul>
        <div className="flex flex-col gap-1.5 border-t border-border p-3">
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="h-8 rounded-md bg-primary text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-45"
          >
            Save merge and mark resolved
          </button>
          <TakeSide path={path} />
        </div>
      </aside>
    </div>
  )
}

/** How one side left a conflicting part of a node. */
function describePart(n: WorkflowConflict["ours"], field: string): string {
  if (!n) return "removed"
  if (field === "node") return n.uses
  if (field.startsWith("in.")) {
    const f = field.slice(3)
    const ref =
      f === ""
        ? typeof n.in === "string"
          ? n.in
          : undefined
        : (n.in as Record<string, string> | undefined)?.[f]
    return ref === undefined ? "not connected" : `← ${ref}`
  }
  if (field.startsWith("values.")) {
    const v = n.values?.[field.slice(7)]
    return v === undefined ? "not set" : formatValue(v)
  }
  const v = (n as unknown as Record<string, unknown>)[field]
  return v === undefined ? "not set" : formatValue(v)
}

function ConflictCard({
  conflict: c,
  choice,
  onChoose,
}: {
  conflict: WorkflowConflict
  choice: MergeSide
  onChoose: (side: MergeSide) => void
}) {
  return (
    <li
      className="mb-2 rounded-lg border border-border bg-background p-2 text-[12px]"
      data-testid="merge-conflict"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">{c.nodeId}</span>
        <fieldset
          aria-label={`Version of ${c.nodeId}`}
          className="m-0 flex gap-0.5 rounded-md border-0 bg-muted p-0.5"
        >
          {(["ours", "theirs"] as const).map((side) => (
            <button
              key={side}
              type="button"
              aria-pressed={choice === side}
              onClick={() => onChoose(side)}
              className={cn(
                "rounded px-2 py-0.5 text-[11.5px]",
                choice === side
                  ? "bg-popover font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {side === "ours" ? "Ours" : "Theirs"}
            </button>
          ))}
        </fieldset>
      </div>
      <dl className="flex flex-col gap-1.5 text-[11px]">
        {c.fields.map((f) => (
          <div key={f}>
            <dt className="text-muted-foreground">
              {f === "node" ? "the whole node" : f.replace(/^(in|values)\./, "")}
            </dt>
            {(["ours", "theirs"] as const).map((side) => (
              <dd
                key={side}
                className={cn(
                  "flex min-w-0 gap-2 pl-2 font-mono",
                  choice === side ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="w-11 shrink-0 font-sans">
                  {side === "ours" ? "ours" : "theirs"}
                </span>
                <span className={cn("min-w-0 break-all", choice !== side && "line-through")}>
                  {describePart(c[side], f)}
                </span>
              </dd>
            ))}
          </div>
        ))}
      </dl>
    </li>
  )
}

/** Resolve by taking one side wholesale. */
function TakeSide({ path }: { path: string }) {
  const busy = useGitStore((s) => s.busy)
  const take = (side: MergeSide) => void useGitStore.getState().resolve(path, { take: side })
  return (
    <div className="flex gap-1.5">
      {(["ours", "theirs"] as const).map((side) => (
        <button
          key={side}
          type="button"
          disabled={busy}
          onClick={() => take(side)}
          className="h-7 flex-1 rounded-md border border-border text-[12px] hover:bg-accent disabled:opacity-45"
        >
          {side === "ours" ? "Keep ours" : "Take theirs"}
        </button>
      ))}
    </div>
  )
}

const MARKER = /^(<{7}|>{7}|={7})( |$)/m

function TextConflict({ path, sides }: { path: string; sides: Sides }) {
  const theme = useActiveTheme()
  const busy = useGitStore((s) => s.busy)
  const [problem, setProblem] = useState<string | null>(null)
  const markResolved = async () => {
    const now = await fetchGitFile(path, "worktree")
    if (now !== null && MARKER.test(now)) {
      setProblem("The file still has conflict markers (<<<<<<<). Edit them out first.")
      return
    }
    setProblem(null)
    await useGitStore.getState().resolve(path, { content: now ?? "" })
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[12px]">
        <span className="text-muted-foreground">Ours on the left, theirs on the right.</span>
        <span className="flex-1" />
        <TakeSide path={path} />
        {sides.worktree !== null && (
          <>
            <button
              type="button"
              onClick={() => openCodeFile(path)}
              className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 hover:bg-accent"
            >
              <FileCode className="size-3.5" /> Edit the file
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void markResolved()}
              className="h-7 rounded-md bg-primary px-2.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-45"
            >
              Mark resolved
            </button>
          </>
        )}
      </div>
      {problem && (
        <div role="alert" className="px-3 py-1.5 text-[12px] text-destructive">
          {problem}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <DiffEditor
          height="100%"
          language={languageFor(path)}
          original={sides.ours ?? ""}
          modified={sides.theirs ?? ""}
          theme={monacoThemeName(theme)}
          beforeMount={defineMonacoThemes}
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            fontSize: 12.5,
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  )
}
