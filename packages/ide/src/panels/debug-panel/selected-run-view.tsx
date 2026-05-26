import { useState } from "react"
import { useDebugSessionStore } from "@/store/debug-session"
import { cn } from "@/lib/utils"
import { StatusBanner } from "./status-banner"
import { Timeline } from "./timeline"
import { LogsView } from "./logs-view"

export function SelectedRunView() {
  const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)
  const [tab, setTab] = useState<"timeline" | "logs">("timeline")

  if (!selectedRunId) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        Select a run from the list to see details.
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-hidden">
      <StatusBanner runId={selectedRunId} />
      <div className="flex gap-1 border-b text-xs">
        <TabButton active={tab === "timeline"} onClick={() => setTab("timeline")}>Timeline</TabButton>
        <TabButton active={tab === "logs"} onClick={() => setTab("logs")}>Logs</TabButton>
      </div>
      <div className="flex-1 overflow-auto">
        {tab === "timeline" ? (
          <Timeline runId={selectedRunId} />
        ) : (
          <LogsView runId={selectedRunId} />
        )}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1 -mb-px border-b-2 border-transparent",
        active && "border-primary text-foreground",
      )}
    >
      {children}
    </button>
  )
}
