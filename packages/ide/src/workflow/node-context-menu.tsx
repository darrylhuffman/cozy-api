import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  x: number
  y: number
  onDelete: () => void
  onReset: () => void
}

export function NodeContextMenu({ open, onOpenChange, x, y, onDelete, onReset }: Props) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <div
          style={{ position: "fixed", left: x, top: y, width: 1, height: 1, pointerEvents: "none" }}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
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
