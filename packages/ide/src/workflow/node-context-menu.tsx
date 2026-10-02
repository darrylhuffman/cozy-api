import { Sparkles } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  x: number
  y: number
  onDelete: () => void
  onReset: () => void
  /** When provided, renders "Duplicate". */
  onDuplicate?: () => void
  /** When provided, a "View source" button is rendered at the top of the menu. */
  onViewSource?: () => void
  /** When provided, renders "Toggle breakpoint (before)" and "Toggle breakpoint (after)" items. */
  onToggleBreakpointBefore?: () => void
  onToggleBreakpointAfter?: () => void
  /** When provided, renders "Explain with AI". */
  onExplain?: () => void
  /** When provided (local nodes), renders "Write test cases with AI". */
  onGenerateCases?: () => void
  /** When provided, renders "Move to sub-workflow…". */
  onExtract?: () => void
  /** When provided (sub-workflow nodes), renders "Inline sub-workflow". */
  onInline?: () => void
}

export function NodeContextMenu({
  open,
  onOpenChange,
  x,
  y,
  onDelete,
  onReset,
  onDuplicate,
  onViewSource,
  onToggleBreakpointBefore,
  onToggleBreakpointAfter,
  onExplain,
  onGenerateCases,
  onExtract,
  onInline,
}: Props) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <div
          style={{ position: "fixed", left: x, top: y, width: 1, height: 1, pointerEvents: "none" }}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {onExplain && (
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              onExplain()
            }}
            className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
          >
            <Sparkles className="h-3.5 w-3.5 text-ai" /> Explain with AI
          </button>
        )}
        {onGenerateCases && (
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              onGenerateCases()
            }}
            className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
          >
            <Sparkles className="h-3.5 w-3.5 text-ai" /> Write test cases with AI
          </button>
        )}
        {(onExplain || onGenerateCases) && <div className="my-1 h-px bg-border" />}
        {onViewSource && (
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              onViewSource()
            }}
            className="w-full rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
          >
            View source
          </button>
        )}
        {onDuplicate && (
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              onDuplicate()
            }}
            className="flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
          >
            Duplicate
            <span className="text-xs text-muted-foreground">Ctrl+D</span>
          </button>
        )}
        {onExtract && (
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              onExtract()
            }}
            className="flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
          >
            Move to sub-workflow…
            <span className="text-xs text-muted-foreground">Ctrl+G</span>
          </button>
        )}
        {onInline && (
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              onInline()
            }}
            className="flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
          >
            Inline sub-workflow
            <span className="text-xs text-muted-foreground">Ctrl+Shift+G</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onOpenChange(false)
            onReset()
          }}
          className="w-full rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
        >
          Reset connections
        </button>
        {onToggleBreakpointBefore && (
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              onToggleBreakpointBefore()
            }}
            className="w-full rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
          >
            Toggle breakpoint (before)
          </button>
        )}
        {onToggleBreakpointAfter && (
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              onToggleBreakpointAfter()
            }}
            className="w-full rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
          >
            Toggle breakpoint (after)
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onOpenChange(false)
            onDelete()
          }}
          className="w-full rounded px-3 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
        >
          Delete node
        </button>
      </PopoverContent>
    </Popover>
  )
}
