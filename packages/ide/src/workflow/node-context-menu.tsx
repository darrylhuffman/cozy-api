import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  x: number
  y: number
  onDelete: () => void
  onReset: () => void
  /** When provided, a "View source" button is rendered at the top of the menu. */
  onViewSource?: () => void
  /** When provided, renders "Toggle breakpoint (before)" and "Toggle breakpoint (after)" items. */
  onToggleBreakpointBefore?: () => void
  onToggleBreakpointAfter?: () => void
}

export function NodeContextMenu({
  open,
  onOpenChange,
  x,
  y,
  onDelete,
  onReset,
  onViewSource,
  onToggleBreakpointBefore,
  onToggleBreakpointAfter,
}: Props) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <div
          style={{ position: "fixed", left: x, top: y, width: 1, height: 1, pointerEvents: "none" }}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
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
