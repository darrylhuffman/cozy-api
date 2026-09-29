import { useCallback, useEffect, useRef, useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import type { NodeSchemas } from "@/lib/api"
import { AddNodePalette } from "./add-node-palette"

interface Props {
  schemas: Record<string, NodeSchemas>
  onPick: (uses: string) => void
  /** Controlled mode — omit both to let Ctrl+K manage it internally. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CommandPalette({ schemas, onPick, open: openProp, onOpenChange }: Props) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const openRef = useRef(open)
  openRef.current = open
  const setOpen = useCallback(
    (next: boolean | ((o: boolean) => boolean)) => {
      const value = typeof next === "function" ? next(openRef.current) : next
      setOpenState(value)
      onOpenChange?.(value)
    },
    [onOpenChange],
  )

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
  }, [setOpen])

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
