import { DiffEditor } from "@monaco-editor/react"
import { ReactFlowProvider } from "@xyflow/react"
import { ArrowLeftRight, ChevronLeft, ChevronRight, Minus, Plus, Undo2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { languageFor } from "@/code/code-editor"
import {
  fetchGitFile,
  type GitRevision,
  parseWorkflowContent,
  saveFile,
  type WorkflowFile,
} from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"
import { defineMonacoThemes, monacoThemeName } from "@/lib/monaco-theme"
import { cn } from "@/lib/utils"
import { useGitStore } from "@/store/git"
import { useActiveTheme } from "@/store/theme"
import { serializeWorkflow } from "@/store/workflow-drafts"
import {
  type ChangeKind,
  diffWorkflows,
  revertChange,
  type WorkflowChange,
} from "@/workflow/workflow-diff"
import { type DiffFilters, STATE_COLOR, WorkflowDiffCanvas } from "./workflow-diff-canvas"

export const REVISION_LABEL: Record<GitRevision, string> = {
  HEAD: "HEAD",
  index: "staged",
  worktree: "working copy",
  base: "common ancestor",
  ours: "ours",
  theirs: "theirs",
}

type Mode = "visual" | "text"

/**
 * A file's changes between two revisions. Workflows open as a visual graph
 * diff with a list of the changes; any file can be read as text side by side.
 */
export function DiffView({
  path,
  base,
  head,
}: {
  path: string
  base: GitRevision
  head: GitRevision
}) {
  const [texts, setTexts] = useState<{ base: string | null; head: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isWorkflow = path.endsWith(".workflow")
  const [mode, setMode] = useState<Mode>(isWorkflow ? "visual" : "text")
  // Staging or committing changes what "staged" and "HEAD" hold.
  const gitStatus = useGitStore((s) => s.status)

  const load = useCallback(() => {
    let alive = true
    Promise.all([fetchGitFile(path, base), fetchGitFile(path, head)])
      .then(([b, h]) => {
        if (!alive) return
        setTexts({ base: b, head: h })
        setError(null)
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [path, base, head])

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when git status changes
  useEffect(() => load(), [load, gitStatus])
  useEffect(
    () =>
      subscribeToFileEvents((e) => {
        if (e.path === path || e.type === "ready") load()
      }),
    [load, path],
  )

  if (error) return <div className="p-4 text-sm text-destructive">{error}</div>
  if (!texts) return <div className="p-4 text-sm text-muted-foreground">Loading {path}…</div>

  return (
    <div className="flex h-full flex-col" data-testid="diff-view">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3 text-[12.5px]">
        <span className="font-semibold">{path.split("/").pop()}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {REVISION_LABEL[base]} ↔ {REVISION_LABEL[head]}
        </span>
        <span className="flex-1" />
        {isWorkflow && (
          <div
            role="tablist"
            aria-label="Diff view"
            className="flex gap-0.5 rounded-md bg-muted p-0.5"
          >
            {(["visual", "text"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded px-2.5 py-0.5 text-[12px]",
                  mode === m
                    ? "bg-popover font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "visual" ? "Visual" : "JSON"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {mode === "visual" && isWorkflow ? (
          <VisualDiff path={path} texts={texts} canRevert={head === "worktree"} />
        ) : (
          <TextDiff path={path} base={texts.base ?? ""} head={texts.head ?? ""} />
        )}
      </div>
    </div>
  )
}

function TextDiff({ path, base, head }: { path: string; base: string; head: string }) {
  const theme = useActiveTheme()
  return (
    <DiffEditor
      height="100%"
      language={languageFor(path)}
      original={base}
      modified={head}
      theme={monacoThemeName(theme)}
      beforeMount={defineMonacoThemes}
      options={{
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        fontSize: 12.5,
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        scrollBeyondLastLine: false,
        automaticLayout: true,
      }}
    />
  )
}

function parse(path: string, text: string | null): WorkflowFile | null {
  if (text === null) return null
  try {
    return parseWorkflowContent(path, text)
  } catch {
    return null
  }
}

const SYMBOL: Record<ChangeKind, "add" | "remove" | "change"> = {
  "node-added": "add",
  connected: "add",
  "node-removed": "remove",
  disconnected: "remove",
  "uses-changed": "change",
  "label-changed": "change",
  rewired: "change",
  "value-changed": "change",
  "after-changed": "change",
  "when-changed": "change",
}

function VisualDiff({
  path,
  texts,
  canRevert,
}: {
  path: string
  texts: { base: string | null; head: string | null }
  canRevert: boolean
}) {
  const before = useMemo(() => parse(path, texts.base), [path, texts.base])
  const after = useMemo(() => parse(path, texts.head), [path, texts.head])
  const diff = useMemo(() => diffWorkflows(before, after), [before, after])
  const [filters, setFilters] = useState<DiffFilters>({ added: true, changed: true, removed: true })
  const [focusId, setFocusId] = useState<string | null>(null)
  const [revertError, setRevertError] = useState<string | null>(null)
  const changedIds = useMemo(
    () => Object.keys(diff.nodes).filter((id) => diff.nodes[id] !== "same"),
    [diff],
  )
  const focusIndex = focusId ? changedIds.indexOf(focusId) : -1
  const step = (by: number) => {
    if (changedIds.length === 0) return
    const next = (focusIndex + by + changedIds.length) % changedIds.length
    setFocusId(changedIds[next] ?? null)
  }
  const counts = {
    added: changedIds.filter((id) => diff.nodes[id] === "added").length,
    changed: changedIds.filter((id) => diff.nodes[id] === "changed").length,
    removed: changedIds.filter((id) => diff.nodes[id] === "removed").length,
  }

  const revert = async (change: WorkflowChange) => {
    if (!before || !after) return
    try {
      await saveFile(path, serializeWorkflow(revertChange(after, before, change)))
      setRevertError(null)
    } catch (e) {
      setRevertError((e as Error).message)
    }
  }

  if ((texts.base !== null && !before) || (texts.head !== null && !after)) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        One side isn't a valid workflow, so there's no graph to compare. Switch to JSON.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-[12px]">
        {(["added", "changed", "removed"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={filters[k]}
            onClick={() => setFilters((f) => ({ ...f, [k]: !f[k] }))}
            className={cn(
              "flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5",
              filters[k] ? "text-foreground" : "text-muted-foreground opacity-60",
            )}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: STATE_COLOR[k] }} />
            {k === "added" ? "Added" : k === "changed" ? "Changed" : "Removed"}
            <span className="text-muted-foreground">{counts[k]}</span>
          </button>
        ))}
        <span className="flex-1" />
        {changedIds.length > 0 && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <button
              type="button"
              aria-label="Previous change"
              onClick={() => step(-1)}
              className="rounded p-0.5 hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[48px] text-center tabular-nums">
              {focusIndex < 0
                ? `${changedIds.length} nodes`
                : `${focusIndex + 1} of ${changedIds.length}`}
            </span>
            <button
              type="button"
              aria-label="Next change"
              onClick={() => step(1)}
              className="rounded p-0.5 hover:bg-accent hover:text-foreground"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <ReactFlowProvider>
          <WorkflowDiffCanvas
            before={before}
            after={after}
            diff={diff}
            filters={filters}
            focusId={focusId}
          />
        </ReactFlowProvider>
      </div>
      <div
        className="max-h-[220px] shrink-0 overflow-y-auto border-t border-border px-3 py-2"
        data-testid="change-list"
      >
        <div className="mb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {diff.changes.length === 0 && diff.moved.length === 0
            ? "No changes in this workflow"
            : `${diff.changes.length} ${diff.changes.length === 1 ? "change" : "changes"} in this workflow`}
        </div>
        {revertError && <div className="mb-1 text-[12px] text-destructive">{revertError}</div>}
        <ul className="flex flex-col text-[12.5px]">
          {diff.changes.map((c, i) => {
            const sym = SYMBOL[c.kind]
            const Icon = sym === "add" ? Plus : sym === "remove" ? Minus : ArrowLeftRight
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: changes are recomputed as a whole
                key={i}
                className={cn(
                  "group flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent/60",
                  focusId === c.nodeId && "bg-accent/60",
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    sym === "add"
                      ? "text-success"
                      : sym === "remove"
                        ? "text-destructive"
                        : "text-warning",
                  )}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-mono text-[12px]"
                  title={c.text}
                  onClick={() => setFocusId(c.nodeId)}
                >
                  {c.text}
                </button>
                {canRevert && (
                  <button
                    type="button"
                    aria-label={`Revert: ${c.text}`}
                    onClick={() => void revert(c)}
                    className="flex shrink-0 items-center gap-1 rounded px-1.5 text-[11.5px] text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  >
                    <Undo2 className="h-3 w-3" aria-hidden />
                    Revert
                  </button>
                )}
              </li>
            )
          })}
          {diff.moved.length > 0 && (
            <li className="flex items-center gap-2 px-1.5 py-1 text-muted-foreground">
              <ArrowLeftRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
              Moved {diff.moved.length} {diff.moved.length === 1 ? "node" : "nodes"} (layout only)
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
