import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { FileFolder } from "@/data/mock-files"
import { createWorkspaceFile, fetchWorkspaceTree } from "@/lib/api"
import { FolderPicker } from "./folder-picker"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new workflow's relative path (e.g. "workflows/users/list.workflow"). */
  onCreated: (path: string) => void
  /** Defaults to "workflows". */
  defaultFolder?: string
  /** If omitted, the dialog fetches the tree on open. */
  workflowsTree?: FileFolder
}

const WORKFLOW_SEED = '{"lorien":1,"nodes":{}}\n'

export function NewWorkflowDialog({
  open,
  onOpenChange,
  onCreated,
  defaultFolder = "workflows",
  workflowsTree,
}: Props) {
  const [folder, setFolder] = useState(defaultFolder)
  const [name, setName] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tree, setTree] = useState<FileFolder | null>(workflowsTree ?? null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (open) {
      setFolder(defaultFolder)
      setName("")
      setPickerOpen(false)
      setError(null)
      fetchedRef.current = false
    }
  }, [open, defaultFolder])

  useEffect(() => {
    if (!open || workflowsTree || fetchedRef.current) return
    fetchedRef.current = true
    fetchWorkspaceTree()
      .then((t) => setTree(t.workflows))
      .catch(() => {})
  }, [open, workflowsTree])

  async function handleCreate() {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed.includes("/")) {
      setError("Name cannot contain slashes")
      return
    }
    const bare = trimmed.replace(/\.workflow$/, "")
    const fullPath = `${folder}/${bare}.workflow`
    try {
      await createWorkspaceFile(fullPath, WORKFLOW_SEED)
      onOpenChange(false)
      onCreated(fullPath)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const activeTree = workflowsTree ?? tree

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Folder</span>
              <button
                type="button"
                onClick={() => setPickerOpen((p) => !p)}
                className="rounded px-2 py-0.5 hover:bg-accent"
                disabled={!activeTree}
              >
                Change
              </button>
            </div>
            <div className="rounded border border-border bg-muted/30 px-2 py-1 text-sm">
              {folder}
            </div>
            {pickerOpen && activeTree && (
              <FolderPicker
                root={activeTree}
                value={folder}
                onChange={(p) => {
                  setFolder(p)
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
              placeholder="create"
              autoFocus
            />
            <div className="text-xs text-muted-foreground">.workflow will be appended</div>
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded px-3 py-1.5 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={name.trim().length === 0}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
