import { DiffEditor, type DiffOnMount } from "@monaco-editor/react"
import { ReactFlowProvider } from "@xyflow/react"
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Minus,
  Plus,
  Undo2,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { languageFor } from "@/code/code-editor"
import {
  fetchGitFile,
  type GitRevision,
  parseWorkflowContent,
  saveFile,
  type WorkflowFile,
} from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"
import { applyHunk, diffLines, type Hunk } from "@/lib/line-diff"
import { defineMonacoThemes, monacoThemeName } from "@/lib/monaco-theme"
import { openWorkspaceFile } from "@/lib/open-file"
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
 * What a single change can do in this comparison: between staged and the
 * working copy it can be staged or discarded, between HEAD and staged it can
 * be unstaged. Other comparisons are read-only.
 */
export type ChangeActions = "worktree" | "index" | null

function actionsFor(base: GitRevision, head: GitRevision): ChangeActions {
  if (base === "index" && head === "worktree") return "worktree"
  if (base === "HEAD" && head === "index") return "index"
  return null
}

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
        {(head === "worktree" || head === "index") && texts.head !== null && (
          <button
            type="button"
            onClick={() => openWorkspaceFile(path)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ExternalLink aria-hidden className="size-3.5" />
            Open file
          </button>
        )}
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
          <VisualDiff path={path} texts={texts} actions={actionsFor(base, head)} />
        ) : (
          <TextDiff
            path={path}
            base={texts.base ?? ""}
            head={texts.head ?? ""}
            actions={actionsFor(base, head)}
          />
        )}
      </div>
    </div>
  )
}

/** The hunk at or after `line` (1-based, in the head), else the last one. */
function hunkAt(hunks: Hunk[], line: number): number {
  const i = hunks.findIndex((h) => line <= Math.max(h.headEnd, h.headStart + 1))
  return i < 0 ? hunks.length - 1 : i
}

function TextDiff({
  path,
  base,
  head,
  actions,
}: {
  path: string
  base: string
  head: string
  actions: ChangeActions
}) {
  const theme = useActiveTheme()
  const hunks = useMemo(() => diffLines(base, head), [base, head])
  const [current, setCurrent] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<Parameters<DiffOnMount>[0] | null>(null)
  const hunksRef = useRef(hunks)
  hunksRef.current = hunks
  const index = Math.min(current, hunks.length - 1)
  const hunk = hunks[index]

  const reveal = (i: number) => {
    const h = hunks[i]
    const editor = editorRef.current?.getModifiedEditor()
    setCurrent(i)
    if (!h || !editor) return
    const line = Math.max(1, h.headStart + 1)
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: 1 })
  }
  const step = (by: number) => {
    if (hunks.length === 0) return
    reveal((index + by + hunks.length) % hunks.length)
  }

  // Detach the models before disposing them; the diff widget throws if its
  // models go first, which happens when a diff tab closes or switches away.
  useEffect(
    () => () => {
      const editor = editorRef.current
      const models = editor?.getModel()
      editor?.setModel(null)
      models?.original.dispose()
      models?.modified.dispose()
    },
    [],
  )

  const onMount: DiffOnMount = (editor) => {
    editorRef.current = editor
    // Following the cursor, so clicking into a change picks it.
    editor.getModifiedEditor().onDidChangeCursorPosition((e) => {
      if (e.source === "api") return
      setCurrent(hunkAt(hunksRef.current, e.position.lineNumber))
    })
  }

  const apply = async (kind: "stage" | "unstage" | "discard") => {
    if (!hunk) return
    try {
      if (kind === "discard") {
        await saveFile(path, applyHunk(base, head, hunk, "to-base"))
      } else {
        const next = applyHunk(base, head, hunk, kind === "stage" ? "to-head" : "to-base")
        if (!(await useGitStore.getState().setStaged(path, next))) {
          throw new Error(useGitStore.getState().error ?? "Couldn't update what's staged")
        }
      }
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const button =
    "flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-45"
  return (
    <div className="flex h-full flex-col">
      {hunks.length > 0 && (
        <div
          className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-[12px]"
          data-testid="hunk-bar"
        >
          <div className="flex items-center gap-1 text-muted-foreground">
            <button
              type="button"
              aria-label="Previous change"
              onClick={() => step(-1)}
              className="rounded p-0.5 hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[72px] text-center tabular-nums" data-testid="hunk-position">
              Change {index + 1} of {hunks.length}
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
          {error && <span className="truncate text-destructive">{error}</span>}
          <span className="flex-1" />
          {actions === "worktree" && (
            <>
              <button type="button" className={button} onClick={() => void apply("discard")}>
                <Undo2 aria-hidden className="size-3.5" />
                Discard change
              </button>
              <button type="button" className={button} onClick={() => void apply("stage")}>
                <Plus aria-hidden className="size-3.5" />
                Stage change
              </button>
            </>
          )}
          {actions === "index" && (
            <button type="button" className={button} onClick={() => void apply("unstage")}>
              <Minus aria-hidden className="size-3.5" />
              Unstage change
            </button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <DiffEditor
          height="100%"
          language={languageFor(path)}
          original={base}
          modified={head}
          theme={monacoThemeName(theme)}
          beforeMount={defineMonacoThemes}
          onMount={onMount}
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            fontSize: 12.5,
            fontFamily:
              "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
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

/** The same change seen from the other side: what staging it adds back. */
const INVERSE: Partial<Record<ChangeKind, ChangeKind>> = {
  "node-added": "node-removed",
  "node-removed": "node-added",
  connected: "disconnected",
  disconnected: "connected",
}

function VisualDiff({
  path,
  texts,
  actions,
}: {
  path: string
  texts: { base: string | null; head: string | null }
  actions: ChangeActions
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
  /** Stages a working-copy change, or unstages a staged one, in the index only. */
  const restage = async (change: WorkflowChange) => {
    if (!before || !after) return
    const next =
      actions === "worktree"
        ? revertChange(before, after, { ...change, kind: INVERSE[change.kind] ?? change.kind })
        : revertChange(after, before, change)
    if (await useGitStore.getState().setStaged(path, serializeWorkflow(next))) {
      setRevertError(null)
    } else {
      setRevertError(useGitStore.getState().error)
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
                {actions === "worktree" && (
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
                {actions && before && after && (
                  <button
                    type="button"
                    aria-label={`${actions === "worktree" ? "Stage" : "Unstage"}: ${c.text}`}
                    onClick={() => void restage(c)}
                    className="flex shrink-0 items-center gap-1 rounded px-1.5 text-[11.5px] text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  >
                    {actions === "worktree" ? (
                      <Plus className="h-3 w-3" aria-hidden />
                    ) : (
                      <Minus className="h-3 w-3" aria-hidden />
                    )}
                    {actions === "worktree" ? "Stage" : "Unstage"}
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
