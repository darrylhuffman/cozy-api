import { useDebugSessionStore } from "@/store/debug-session"
import { LogsView } from "./logs-view"
import { StatusBanner } from "./status-banner"
import { Timeline } from "./timeline"

export function SelectedRunView() {
  const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)

  if (!selectedRunId) {
    return (
      <div className="p-3">
        <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
          Select a run from the list to see details.
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StatusBanner runId={selectedRunId} />
      <div className="@container flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-auto @3xl:flex-row @3xl:overflow-hidden">
          <section
            aria-label="Timeline"
            className="flex min-w-0 flex-col border-b border-border @3xl:flex-1 @3xl:overflow-auto @3xl:border-r @3xl:border-b-0"
          >
            <Timeline runId={selectedRunId} />
          </section>
          <section
            aria-label="Logs"
            className="flex min-w-0 flex-col @3xl:flex-1 @3xl:overflow-auto"
          >
            <LogsView runId={selectedRunId} />
          </section>
        </div>
      </div>
    </div>
  )
}
