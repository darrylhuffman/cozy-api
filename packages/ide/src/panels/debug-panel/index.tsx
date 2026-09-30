import { useDebugTransport } from "@/hooks/use-debug-transport"
import { RunsList } from "./runs-list"
import { SectionLabel } from "./section-label"
import { SelectedRunView } from "./selected-run-view"

export function DebugPanel() {
  useDebugTransport()
  return (
    <div className="flex h-full min-h-0 bg-background text-[13px]" data-testid="debug-panel">
      <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-r border-border p-2">
        <SectionLabel className="px-2 pt-1 pb-2">Runs</SectionLabel>
        <RunsList />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <SelectedRunView />
      </div>
    </div>
  )
}
