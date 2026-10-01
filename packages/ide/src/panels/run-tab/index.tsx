import { useEffect } from "react"
import { useDebugTransport } from "@/hooks/use-debug-transport"
import { cn } from "@/lib/utils"
import { useDebugSessionStore } from "@/store/debug-session"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useRequestEditor } from "@/store/request-editor"
import { useTabsStore } from "@/store/tabs"
import { EnvironmentPicker } from "./environment-picker"
import { HistoryTable } from "./history-table"
import { RequestBuilder } from "./request-builder"
import { SavedRequests } from "./saved-requests"
import { ScheduleRun } from "./schedule-run"
import { SCHEDULE_METHOD, TriggerSelector } from "./trigger-selector"

export function RunTab() {
  useDebugTransport()
  const connected = useDebugSessionStore((s) => s.connected)
  const liveTabId = useLiveWorkflowStore((s) => s.tabId)
  const workflowPath = useTabsStore((s) => s.tabs.find((t) => t.id === liveTabId)?.path ?? "")
  const scheduleNodeId = useDebugSessionStore((s) =>
    s.requestForm.method === SCHEDULE_METHOD ? s.requestForm.triggerNodeId : null,
  )
  // A saved request belongs to one workflow; don't carry it into another.
  useEffect(() => {
    useRequestEditor.getState().bindWorkflow(workflowPath)
  }, [workflowPath])
  return (
    <div className="flex h-full flex-col gap-3 text-[13px]" data-testid="run-tab">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <TriggerSelector />
        <div className="flex min-w-0 items-center gap-2">
          <EnvironmentPicker />
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px]",
              connected ? "text-success" : "text-muted-foreground",
            )}
            title={connected ? "Debugger connected" : "Debugger disconnected"}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                connected ? "bg-success" : "border border-muted-foreground/60",
              )}
            />
            {connected ? "debug connected" : "debug disconnected"}
          </span>
        </div>
      </div>
      {scheduleNodeId ? (
        workflowPath && (
          <ScheduleRun workflowPath={workflowPath} nodeId={scheduleNodeId} tabId={liveTabId} />
        )
      ) : (
        <>
          {workflowPath && <SavedRequests key={workflowPath} workflowPath={workflowPath} />}
          <div className="h-px shrink-0 bg-border" />
          {workflowPath && <RequestBuilder workflowPath={workflowPath} />}
        </>
      )}
      <div className="h-px shrink-0 bg-border" />
      <HistoryTable />
    </div>
  )
}
