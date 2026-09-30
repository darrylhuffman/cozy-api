import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { renameItem, splitName, type WorkspaceItem } from "@/lib/workspace-items"

interface Props {
  item: WorkspaceItem | null
  onOpenChange: (open: boolean) => void
}

/** Renames a workflow or node in place; the extension stays as it is. */
export function RenameItemDialog({ item, onOpenChange }: Props) {
  const [stem, setStem] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ext = item ? splitName(item.path).ext : ""

  useEffect(() => {
    if (item) {
      setStem(splitName(item.path).stem)
      setError(null)
      setBusy(false)
    }
  }, [item])

  async function submit() {
    if (!item) return
    setBusy(true)
    setError(null)
    try {
      await renameItem(item, stem.trim())
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const title = item?.kind === "workflow" ? "Rename workflow" : "Rename node"
  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Name</div>
              <div className="flex items-center gap-1.5">
                <Input
                  aria-label="New name"
                  value={stem}
                  onChange={(e) => setStem(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  autoFocus
                  className="font-mono"
                />
                <span className="font-mono text-sm text-muted-foreground">{ext}</span>
              </div>
            </div>
            {item?.kind === "node" && (
              <p className="text-xs text-muted-foreground">
                Workflows that use this node are updated to the new name, and its test cases move
                with it.
              </p>
            )}
            {item?.kind === "workflow" && (
              <p className="text-xs text-muted-foreground">
                Its saved requests move with it. The workflow's route doesn't change.
              </p>
            )}
            {error && (
              <div role="alert" className="text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded px-3 py-1.5 text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || stem.trim().length === 0}
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              Rename
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
