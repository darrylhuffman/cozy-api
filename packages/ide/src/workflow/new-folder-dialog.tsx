import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { FileFolder } from "@/data/mock-files"
import { createWorkspaceFolder } from "@/lib/api"
import { FolderPicker } from "./folder-picker"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new folder's relative path (e.g. "workflows/admin"). */
  onCreated: (path: string) => void
  /** Parent folder to default to. */
  defaultFolder: string
  /** Tree root for the picker. */
  root: FileFolder
}

export function NewFolderDialog({
  open,
  onOpenChange,
  onCreated,
  defaultFolder,
  root,
}: Props) {
  const [parent, setParent] = useState(defaultFolder)
  const [name, setName] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setParent(defaultFolder)
      setName("")
      setPickerOpen(false)
      setError(null)
    }
  }, [open, defaultFolder])

  async function handleCreate() {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed.includes("/")) {
      setError("Name cannot contain slashes")
      return
    }
    const fullPath = `${parent}/${trimmed}`
    try {
      await createWorkspaceFolder(fullPath)
      onOpenChange(false)
      onCreated(fullPath)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleCreate()
          }}
        >
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Inside</span>
                <button
                  type="button"
                  onClick={() => setPickerOpen((p) => !p)}
                  className="rounded px-2 py-0.5 hover:bg-accent"
                >
                  Change
                </button>
              </div>
              <div className="rounded border border-border bg-muted/30 px-2 py-1 text-sm">
                {parent}
              </div>
              {pickerOpen && (
                <FolderPicker
                  root={root}
                  value={parent}
                  onChange={(p) => {
                    setParent(p)
                    setPickerOpen(false)
                  }}
                />
              )}
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Name</div>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="admin"
                autoFocus
              />
            </div>
            {error && <div className="text-sm text-destructive">{error}</div>}
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
              disabled={name.trim().length === 0}
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
