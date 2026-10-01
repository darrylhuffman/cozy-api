import { cronProblem, describeCron } from "@darrylondil/lorien-runtime/schedule"
import { CalendarClock } from "lucide-react"
import { useInspectorTab } from "@/store/inspector-tab"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useSelectionStore } from "@/store/selection"
import { scheduleValues } from "@/workflow/schedule"
import { RunNow } from "@/workflow/schedule-editor"

/** The Run tab for a schedule trigger: what it runs on, and Run now. */
export function ScheduleRun({
  workflowPath,
  nodeId,
  tabId,
}: {
  workflowPath: string
  nodeId: string
  tabId: string | null
}) {
  const instance = useLiveWorkflowStore((s) => s.workflow?.nodes[nodeId])
  const { cron, timezone } = scheduleValues(instance)
  const problem = cronProblem(cron, timezone)
  return (
    <div className="flex flex-col gap-2.5" data-testid="schedule-run">
      <div className="flex items-start gap-2.5 rounded-md bg-muted/40 px-3 py-2.5">
        <CalendarClock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium text-[13px]">
            {problem ? "Not a valid schedule" : describeCron(cron)}
          </span>
          <span className="text-xs text-muted-foreground">
            {problem ??
              `In ${timezone}. lorien dev and the built server run it on schedule; here it runs when you ask.`}
          </span>
        </div>
      </div>
      <RunNow workflowPath={workflowPath} nodeId={nodeId} tabId={tabId} />
      <button
        type="button"
        onClick={() => {
          useSelectionStore.getState().setSelected(nodeId)
          useInspectorTab.getState().setTab("inspect")
        }}
        className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Edit the schedule
      </button>
    </div>
  )
}
