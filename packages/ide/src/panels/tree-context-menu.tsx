import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  x: number
  y: number
  tree: "workflows" | "nodes"
  onNewFolder: () => void
  onNewItem: () => void
  /** Set when the menu was opened on a workflow or node file. */
  item?: { name: string } | undefined
  onRename?: () => void
  onDelete?: () => void
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
  item,
  onRename,
  onDelete,
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
        {item && (
          <>
            <hr className="-mx-1 my-1 border-border" />
            <MenuItem
              onClick={() => {
                onOpenChange(false)
                onRename?.()
              }}
            >
              Rename…
            </MenuItem>
            <MenuItem
              destructive
              onClick={() => {
                onOpenChange(false)
                onDelete?.()
              }}
            >
              Delete
            </MenuItem>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

function MenuItem({
  onClick,
  children,
  destructive,
}: {
  onClick: () => void
  children: React.ReactNode
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "w-full rounded px-3 py-1.5 text-left text-sm hover:bg-accent",
        destructive && "text-destructive hover:bg-destructive/10",
      )}
    >
      {children}
    </button>
  )
}
