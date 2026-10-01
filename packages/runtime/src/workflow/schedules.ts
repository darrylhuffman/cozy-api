import { cronProblem } from "../schedule/cron.js"
import type { WorkflowFile } from "./types.js"

export const HTTP_TRIGGER = "@core/http-request"
export const SCHEDULE_TRIGGER = "@core/schedule"

/** Node types that start a run. Each owns the nodes downstream of it. */
export const TRIGGER_USES: ReadonlySet<string> = new Set([HTTP_TRIGGER, SCHEDULE_TRIGGER])

export function isTriggerUses(uses: string): boolean {
  return TRIGGER_USES.has(uses)
}

/** Used when a schedule node doesn't set `values.cron`: every day at 09:00. */
export const DEFAULT_CRON = "0 9 * * *"

/** One schedule a workflow runs on: an `@core/schedule` node's cron and time zone. */
export interface WorkflowSchedule {
  nodeId: string
  cron: string
  timezone: string
}

/** The schedules a workflow file runs on, one per `@core/schedule` node. */
export function workflowSchedules(file: WorkflowFile): WorkflowSchedule[] {
  const out: WorkflowSchedule[] = []
  for (const [nodeId, inst] of Object.entries(file.nodes)) {
    if (inst.uses !== SCHEDULE_TRIGGER) continue
    const values = (inst.values ?? {}) as Record<string, unknown>
    const cron =
      typeof values.cron === "string" && values.cron.trim() ? values.cron.trim() : DEFAULT_CRON
    const timezone =
      typeof values.timezone === "string" && values.timezone.trim() ? values.timezone.trim() : "UTC"
    out.push({ nodeId, cron, timezone })
  }
  return out
}

/** Problems with a schedule node's settings, as `[field, message]` pairs. */
export function scheduleProblems(file: WorkflowFile, nodeId: string): Array<[string, string]> {
  const inst = file.nodes[nodeId]
  if (!inst || inst.uses !== SCHEDULE_TRIGGER) return []
  const problems: Array<[string, string]> = []
  // The timers are set when the server starts, so the settings must be literal.
  if (inst.in !== undefined)
    problems.push(["in", "a schedule's cron and timezone are set under `values`, not wired in"])
  const values = (inst.values ?? {}) as Record<string, unknown>
  if (values.cron !== undefined && typeof values.cron !== "string")
    problems.push(["cron", "`cron` must be a string"])
  if (values.timezone !== undefined && typeof values.timezone !== "string")
    problems.push(["timezone", "`timezone` must be a string"])
  if (problems.length > 0) return problems
  const [schedule] = workflowSchedules({ lorien: 1, nodes: { [nodeId]: inst } })
  const cronIssue = cronProblem(schedule!.cron)
  if (cronIssue) problems.push(["cron", cronIssue])
  else {
    const tzIssue = cronProblem(schedule!.cron, schedule!.timezone)
    if (tzIssue) problems.push(["timezone", tzIssue])
  }
  return problems
}
