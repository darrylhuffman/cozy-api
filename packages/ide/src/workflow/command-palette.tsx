import { useEffect, useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import type { NodeSchemas } from "@/lib/api"
import { AddNodePalette } from "./add-node-palette"

interface Props {
  schemas: Record<string, NodeSchemas>
  onPick: (uses: string) => void
}

export function CommandPalette({ schemas, onPick }: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === "Escape") {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0">
        <AddNodePalette
          schemas={schemas}
          onPick={(uses) => {
            setOpen(false)
            onPick(uses)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
