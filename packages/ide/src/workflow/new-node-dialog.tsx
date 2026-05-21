import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { createWorkspaceFile } from "@/lib/api"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the relative `uses` path after the file is created. */
  onCreated: (uses: string) => void
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

export function NewNodeDialog({ open, onOpenChange, onCreated }: Props) {
  const [path, setPath] = useState("nodes/")
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    setError(null)
    let p = path.trim()
    if (!p.endsWith(".ts")) p = `${p}.ts`
    try {
      await createWorkspaceFile(p, TEMPLATE)
      // The `uses` form is "./<path>" without ".ts"
      const uses = `./${p.replace(/\.ts$/, "")}`
      onOpenChange(false)
      onCreated(uses)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New custom node</DialogTitle>
        </DialogHeader>
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="nodes/my-node.ts"
        />
        {error && <div className="text-sm text-destructive">{error}</div>}
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
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          >
            Create
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
