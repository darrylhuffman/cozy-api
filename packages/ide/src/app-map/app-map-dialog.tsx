import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useAppMapDialog } from "@/lib/open-app-map"
import { AppMapView } from "./app-map-view"

/** The Application map as a near-fullscreen popup over the IDE. */
export function AppMapDialogHost() {
  const open = useAppMapDialog((s) => s.open)
  const setOpen = useAppMapDialog((s) => s.setOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Application map</DialogTitle>
        <DialogDescription className="sr-only">
          Every route, node, middleware and provider in this project, and how they connect.
          Read-only.
        </DialogDescription>
        {open && <AppMapView onClose={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  )
}
