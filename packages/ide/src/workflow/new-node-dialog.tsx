import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { FileFolder } from "@/data/mock-files"
import { createWorkspaceFile, fetchWorkspaceTree } from "@/lib/api"
import { FolderPicker } from "./folder-picker"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the relative `uses` path after the file is created. */
  onCreated: (uses: string) => void
  /** Folder to preselect (relative path, e.g. "nodes/shared"). Defaults to "nodes". */
  defaultFolder?: string
  /** Nodes tree for the picker. If omitted, the dialog fetches it on open. */
  nodesTree?: FileFolder
}

const TEMPLATE = `import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"

export default defineNode({
  inputs: z.object({}),
  outputs: z.object({}),
  async run(input) {
    return {}
  },
})
`

export function NewNodeDialog({
  open,
  onOpenChange,
  onCreated,
  defaultFolder = "nodes",
  nodesTree,
}: Props) {
  const [folder, setFolder] = useState(defaultFolder)
  const [name, setName] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tree, setTree] = useState<FileFolder | null>(nodesTree ?? null)
  const fetchedRef = useRef(false)

  // Reset state when the dialog opens (so a second invocation doesn't show stale name)
  useEffect(() => {
    if (open) {
      setFolder(defaultFolder)
      setName("")
      setPickerOpen(false)
      setError(null)
      fetchedRef.current = false
    }
  }, [open, defaultFolder])

  // Fetch the nodes tree if not provided
  useEffect(() => {
    if (!open || nodesTree || fetchedRef.current) return
    fetchedRef.current = true
    fetchWorkspaceTree()
      .then((t) => setTree(t.nodes))
      .catch(() => {
        // leave tree=null; picker won't open, but user can still type a name
      })
  }, [open, nodesTree])

  async function handleCreate() {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed.includes("/")) {
      setError("Name cannot contain slashes")
      return
    }
    const bare = trimmed.replace(/\.ts$/, "")
    const fullPath = `${folder}/${bare}.ts`
    try {
      await createWorkspaceFile(fullPath, TEMPLATE)
      const uses = `./${fullPath.replace(/\.ts$/, "")}`
      onOpenChange(false)
      onCreated(uses)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const activeTree = nodesTree ?? tree

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New custom node</DialogTitle>
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
              <div className="flex items-stretch overflow-hidden rounded-md border border-input bg-transparent focus-within:ring-1 focus-within:ring-ring">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-node"
                  autoFocus
                  className="flex-1 bg-transparent px-3 py-1 text-sm outline-none placeholder:text-muted-foreground"
                />
                <span className="flex select-none items-center bg-muted px-2 py-1 text-sm text-muted-foreground">
                  .ts
                </span>
              </div>
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
