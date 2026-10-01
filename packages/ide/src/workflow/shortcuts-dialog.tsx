import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = IS_MAC ? "⌘" : "Ctrl"

export const SHORTCUTS: Array<[keys: string, action: string]> = [
  [`${MOD}+S`, "Save"],
  [`${MOD}+Z`, "Undo"],
  [`${MOD}+Shift+Z / ${MOD}+Y`, "Redo"],
  [`${MOD}+K`, "Add a node (palette)"],
  [`${MOD}+D`, "Duplicate selected node"],
  ["Delete / Backspace", "Delete the selected nodes or wire"],
  ["Shift+drag", "Select the nodes in a box"],
  [`Shift+click / ${MOD}+click`, "Add or remove a node from the selection"],
  [`${MOD}+A`, "Select every node"],
  ["Esc", "Clear the selection"],
  ["Shift+1", "Fit the graph to the screen"],
  ["Right-click canvas", "Add a node here"],
  ["Right-click node", "Node actions (source, breakpoints, reset…)"],
  [`${MOD}+,`, "Settings (theme, editor, canvas)"],
  ["?", "Show this list"],
]

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <table className="w-full text-sm">
          <tbody>
            {SHORTCUTS.map(([keys, action]) => (
              <tr key={keys} className="border-b border-border last:border-0">
                <td className="py-1.5 pr-4 font-mono text-xs text-muted-foreground">{keys}</td>
                <td className="py-1.5">{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  )
}
