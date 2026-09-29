import { Keyboard, LayoutGrid, Maximize, Plus, Redo2, Undo2 } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { Diagnostic } from "./diagnose"
import { AskAiPopover } from "./ask-ai-popover"
import { ProblemsPopover } from "./problems-popover"

export type SaveStatus = "clean" | "dirty" | "saving" | "saved" | "error"

interface Props {
  path: string
  status: SaveStatus
  canUndo: boolean
  canRedo: boolean
  diagnostics: Diagnostic[]
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  onAddNode: () => void
  onFitView: () => void
  onTidy: () => void
  onFocusNode: (nodeId: string) => void
  onShowShortcuts: () => void
  /** Adds "Fix these with AI" to the problems list. */
  onFixProblems?: () => void
  /** Renders the "Ask AI" box. */
  onAskAi?: (question: string) => void
  selectedNodeId?: string | null
}

/**
 * The strip above the canvas: where you are (breadcrumb + save state) on the
 * left, what you can do on the right.
 */
export function CanvasToolbar(p: Props) {
  const segments = p.path.replace(/^workflows\//, "").split("/")
  const file = segments.pop() ?? p.path
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background/80 px-2 text-xs">
      <div className="flex min-w-0 flex-1 items-center gap-1 text-muted-foreground" title={p.path}>
        {segments.map((seg, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: path segments are positional
          <span key={i} className="flex items-center gap-1">
            <span className="truncate">{seg}</span>
            <span aria-hidden>/</span>
          </span>
        ))}
        <span className="truncate font-medium text-foreground">{file}</span>
        <SaveBadge status={p.status} onSave={p.onSave} />
      </div>
      {p.onAskAi && <AskAiPopover selectedNodeId={p.selectedNodeId ?? null} onAsk={p.onAskAi} />}
      <ProblemsPopover
        diagnostics={p.diagnostics}
        onFocusNode={p.onFocusNode}
        {...(p.onFixProblems ? { onAskAi: p.onFixProblems } : {})}
      />
      <Divider />
      <ToolButton label="Undo" hint="Undo (Ctrl+Z)" onClick={p.onUndo} disabled={!p.canUndo}>
        <Undo2 className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label="Redo" hint="Redo (Ctrl+Shift+Z)" onClick={p.onRedo} disabled={!p.canRedo}>
        <Redo2 className="h-3.5 w-3.5" />
      </ToolButton>
      <Divider />
      <ToolButton label="Add node" hint="Add node (Ctrl+K)" onClick={p.onAddNode}>
        <Plus className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton label="Tidy layout" hint="Arrange nodes left to right" onClick={p.onTidy}>
        <LayoutGrid className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        label="Fit view"
        hint="Fit the graph to the screen (Shift+1)"
        onClick={p.onFitView}
      >
        <Maximize className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        label="Keyboard shortcuts"
        hint="Keyboard shortcuts (?)"
        onClick={p.onShowShortcuts}
      >
        <Keyboard className="h-3.5 w-3.5" />
      </ToolButton>
    </div>
  )
}

function SaveBadge({ status, onSave }: { status: SaveStatus; onSave: () => void }) {
  if (status === "clean") return null
  if (status === "dirty") {
    return (
      <button
        type="button"
        onClick={onSave}
        title="Save (Ctrl+S)"
        className="ml-2 flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        Unsaved changes — Ctrl+S to save
      </button>
    )
  }
  return (
    <span
      className={cn(
        "ml-2 rounded-full px-2 py-0.5",
        status === "error"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground",
      )}
    >
      {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Not saved"}
    </span>
  )
}

function ToolButton({
  label,
  hint,
  onClick,
  disabled,
  children,
}: {
  label: string
  hint: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={hint}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-border" />
}
