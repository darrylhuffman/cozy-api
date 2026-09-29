import { useEffect } from "react"
import { useDebugTransport } from "@/hooks/use-debug-transport"
import { useDebugSessionStore } from "@/store/debug-session"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useRequestEditor } from "@/store/request-editor"
import { useTabsStore } from "@/store/tabs"
import { EnvironmentPicker } from "./environment-picker"
import { HistoryTable } from "./history-table"
import { RequestBuilder } from "./request-builder"
import { SavedRequests } from "./saved-requests"
import { TriggerSelector } from "./trigger-selector"

export function RunTab() {
  useDebugTransport()
  const connected = useDebugSessionStore((s) => s.connected)
  const liveTabId = useLiveWorkflowStore((s) => s.tabId)
  const workflowPath = useTabsStore((s) => s.tabs.find((t) => t.id === liveTabId)?.path ?? "")
  // A saved request belongs to one workflow; don't carry it into another.
  useEffect(() => {
    useRequestEditor.getState().bindWorkflow(workflowPath)
  }, [workflowPath])
  return (
    <div className="flex h-full flex-col gap-3" data-testid="run-tab">
      <div className="flex items-center justify-between gap-2">
        <EnvironmentPicker />
        <div className="shrink-0 text-[10px]">
          <span className={connected ? "text-green-600" : "text-muted-foreground"}>
            {connected ? "● debug connected" : "○ debug disconnected"}
          </span>
        </div>
      </div>
      <TriggerSelector />
      {workflowPath && <SavedRequests key={workflowPath} workflowPath={workflowPath} />}
      <div className="h-px bg-border" />
      {workflowPath && <RequestBuilder workflowPath={workflowPath} />}
      <div className="h-px bg-border" />
      <HistoryTable />
    </div>
  )
}
