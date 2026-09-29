import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  x: number
  y: number
  tree: "workflows" | "nodes"
  onNewFolder: () => void
  onNewItem: () => void
}

/**
 * Right-click menu for the files panel. Mirrors the Popover + fixed 1x1
 * trigger pattern used by canvas-context-menu and node-context-menu.
 */
export function TreeContextMenu({
  open,
  onOpenChange,
  x,
  y,
  tree,
  onNewFolder,
  onNewItem,
}: Props) {
  const itemLabel = tree === "workflows" ? "New workflow…" : "New node…"
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <div
          style={{ position: "fixed", left: x, top: y, width: 1, height: 1, pointerEvents: "none" }}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <MenuItem
          onClick={() => {
            onOpenChange(false)
            onNewFolder()
          }}
        >
          New folder…
        </MenuItem>
        <MenuItem
          onClick={() => {
            onOpenChange(false)
            onNewItem()
          }}
        >
          {itemLabel}
        </MenuItem>
      </PopoverContent>
    </Popover>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
    >
      {children}
    </button>
  )
}
