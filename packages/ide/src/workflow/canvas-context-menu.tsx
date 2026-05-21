import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { NodeSchemas } from "@/lib/api"
import { AddNodePalette } from "./add-node-palette"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  x: number
  y: number
  schemas: Record<string, NodeSchemas>
  onPick: (uses: string) => void
  onNewCustomNode: () => void
}

export function CanvasContextMenu({ open, onOpenChange, x, y, schemas, onPick, onNewCustomNode }: Props) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <div
          style={{
            position: "fixed",
            left: x,
            top: y,
            width: 1,
            height: 1,
            pointerEvents: "none",
          }}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <AddNodePalette
          schemas={schemas}
          onPick={(uses) => {
            onOpenChange(false)
            onPick(uses)
          }}
        />
        <div className="border-t p-2">
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              onNewCustomNode()
            }}
            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            + New custom node…
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
