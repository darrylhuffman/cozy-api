import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { FileFolder } from "@/data/mock-files"
import { ApiError, createWorkspaceFile } from "@/lib/api"
import { FolderPicker } from "./folder-picker"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the file's path, e.g. "workflows/admin/_middleware.ts". */
  onCreated: (path: string) => void
  /** Folder to preselect, e.g. "workflows/admin". */
  defaultFolder?: string
  workflowsTree: FileFolder
}

export function middlewareTemplate(folder: string): string {
  const scope = folder === "workflows" ? "every route" : `every route in ${folder}/`
  return `import { defineMiddleware } from "@darrylondil/lorien-runtime"

/** Runs before ${scope}, outer folders' middleware first. */
export default defineMiddleware({
  name: "Middleware",
  async run(c, next) {
    // Return a response to stop here, e.g. return c.json({ error: "forbidden" }, 403)
    await next()
  },
})
`
}

/**
 * Creates `<folder>/_middleware.ts`. A folder has at most one; when it
 * already exists, it is opened instead.
 */
export function NewMiddlewareDialog({
  open,
  onOpenChange,
  onCreated,
  defaultFolder = "workflows",
  workflowsTree,
}: Props) {
  const [folder, setFolder] = useState(defaultFolder)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setFolder(defaultFolder)
      setError(null)
    }
  }, [open, defaultFolder])

  async function handleCreate() {
    const path = `${folder}/_middleware.ts`
    try {
      await createWorkspaceFile(path, middlewareTemplate(folder))
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) {
        setError((e as Error).message)
        return
      }
    }
    onOpenChange(false)
    onCreated(path)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New middleware</DialogTitle>
        </DialogHeader>
        <p className="-mt-1 text-xs text-muted-foreground">
          Runs before every route in the folder and below: auth, CORS, rate limits, request logging.
          Business logic stays in nodes.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleCreate()
          }}
        >
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Guard the routes in</div>
            <FolderPicker root={workflowsTree} value={folder} onChange={setFolder} />
            <div className="pt-1 text-xs text-muted-foreground">
              Creates <code className="font-mono text-foreground">{folder}/_middleware.ts</code>
            </div>
          </div>
          {error && <div className="mt-2 text-sm text-destructive">{error}</div>}
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
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              Create
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
