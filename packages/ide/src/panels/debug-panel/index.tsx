import { useDebugTransport } from "@/hooks/use-debug-transport"
import { RunsList } from "./runs-list"
import { SelectedRunView } from "./selected-run-view"

export function DebugPanel() {
  useDebugTransport()
  return (
    <div className="flex h-full flex-col gap-3 p-3" data-testid="debug-panel">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Debug
      </div>
      <RunsList />
      <SelectedRunView />
    </div>
  )
}
