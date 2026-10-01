import { NodeToolbar, Position } from "@xyflow/react"
import { Trash2, X } from "lucide-react"
import type { ReactNode } from "react"
import { useSelectionStore } from "@/store/selection"

interface Props {
  /** Removes every selected node (one undo step). */
  onDelete: () => void
  /** More actions for the group, placed before Delete. */
  children?: ReactNode
}

/**
 * Floats above the nodes when two or more are selected: how many, and what
 * can be done to all of them at once.
 */
export function SelectionToolbar({ onDelete, children }: Props) {
  const ids = useSelectionStore((s) => s.selectedNodeIds)
  if (ids.length < 2) return null
  return (
    <NodeToolbar nodeId={ids} isVisible position={Position.Top} offset={14}>
      <div
        role="toolbar"
        aria-label={`${ids.length} nodes selected`}
        className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-xs shadow-lg"
      >
        <span className="border-r border-border px-2 text-muted-foreground">
          {ids.length} selected
        </span>
        {children}
        <button
          type="button"
          onClick={onDelete}
          title="Delete the selected nodes (Del)"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent"
        >
          <Trash2 aria-hidden className="h-3.5 w-3.5" />
          Delete
        </button>
        <button
          type="button"
          onClick={() => useSelectionStore.getState().setSelected(null)}
          title="Clear the selection (Esc)"
          aria-label="Clear the selection"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
    </NodeToolbar>
  )
}
