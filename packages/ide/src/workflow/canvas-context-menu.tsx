import { useEffect, useState } from "react"
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
  type Mode = "menu" | "palette"
  const [mode, setMode] = useState<Mode>("menu")

  // Reset to action menu whenever the popover closes
  useEffect(() => {
    if (!open) setMode("menu")
  }, [open])

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
      <PopoverContent align="start" className="w-72 p-0">
        {mode === "menu" ? (
          <div className="flex flex-col p-1">
            <MenuItem onClick={() => setMode("palette")}>+ Add existing node…</MenuItem>
            <MenuItem
              onClick={() => {
                onOpenChange(false)
                onNewCustomNode()
              }}
            >
              + New custom node…
            </MenuItem>
          </div>
        ) : (
          <AddNodePalette
            schemas={schemas}
            onPick={(uses) => {
              onOpenChange(false)
              onPick(uses)
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
    >
      {children}
    </button>
  )
}
