import type { Hono } from "hono"
import { resolveCoreNode } from "../core/registry.js"
import { runWorkflow, type WorkflowRunResult } from "../exec/run.js"
import { computeExecutionPlan } from "../exec/topology.js"
import type { ProviderContainer } from "../providers/container.js"
import { describeCron } from "../schedule/cron.js"
import { type ScheduleHandle, startSchedule } from "../schedule/scheduler.js"
import type { AnyNodeOrTrigger, Services } from "../types.js"
import { workflowSchedules } from "../workflow/schedules.js"
import { validateWorkflow } from "../workflow/validate.js"
import { checkWiring } from "../workflow/wiring.js"
import { withRunContext } from "./console-capture.js"
import type { RequestEnvelope } from "./debug-protocol.js"
import type { LoadedWorkflow } from "./load.js"
import type { DebugIntegration } from "./server.js"
import { buildTriggerSlice } from "./trigger-slice.js"

/** POST `{ workflowPath, nodeId }` here to run a schedule now (IDE and `lorien test` only). */
export const RUN_SCHEDULE_PATH = "/__lorien/schedules/run"

/** What a scheduled run shows as its "request" in the debugger's run list. */
export const SCHEDULE_METHOD = "CRON"

export interface ScheduleRunOptions {
  nodes: Record<string, AnyNodeOrTrigger>
  providers?: ProviderContainer
  services?: Services
  debug?: DebugIntegration
}

/** One `@core/schedule` node, checked and ready to run. */
export interface PreparedSchedule {
  workflowPath: string
  nodeId: string
  cron: string
  timezone: string
  /** Runs the workflow from this trigger. `manual` is true for Run now. */
  run: (scheduledAt: Date, manual: boolean) => Promise<WorkflowRunResult>
}

/**
 * The schedules in `workflows` whose workflow is valid, each with a function
 * that runs the workflow from that trigger in its own provider scope.
 * Invalid workflows are skipped here; mountWorkflows already reports them.
 */
export function prepareSchedules(
  workflows: LoadedWorkflow[],
  opts: ScheduleRunOptions,
): PreparedSchedule[] {
  const resolveNode = (uses: string) => resolveCoreNode(uses) ?? opts.nodes[uses] ?? null
  const out: PreparedSchedule[] = []
  for (const wf of workflows) {
    const schedules = workflowSchedules(wf.file)
    if (schedules.length === 0) continue
    const { errors, depsByNode } = validateWorkflow(wf.file)
    if (errors.length > 0 || checkWiring(wf.file, resolveNode).length > 0) continue

    for (const { nodeId, cron, timezone } of schedules) {
      const slice = buildTriggerSlice(wf.file, nodeId, depsByNode)
      const plan = computeExecutionPlan(slice, validateWorkflow(slice).depsByNode)
      const run = async (scheduledAt: Date, manual: boolean): Promise<WorkflowRunResult> => {
        const runId = opts.debug?.newRunId() ?? crypto.randomUUID()
        const startedAt = Date.now()
        const request: RequestEnvelope = { method: SCHEDULE_METHOD, path: cron }
        const debugRun = opts.debug?.buildRun(runId, wf.relativePath, nodeId, request)
        const scope = opts.providers
          ? await opts.providers.open({ requestId: runId, timestamp: startedAt })
          : null
        try {
          const result = await withRunContext(runId, () =>
            runWorkflow({
              workflow: slice,
              plan,
              triggerNodeId: nodeId,
              triggerOutputs: {
                scheduledAt: scheduledAt.toISOString(),
                timestamp: scheduledAt.getTime(),
                manual,
                context: { runId },
              },
              services: (scope?.values ?? opts.services ?? {}) as Services,
              resolveNode,
              ...(debugRun?.lifecycle ? { lifecycle: debugRun.lifecycle } : {}),
              ...(debugRun?.onBeforeNode ? { onBeforeNode: debugRun.onBeforeNode } : {}),
              ...(debugRun?.onAfterNode ? { onAfterNode: debugRun.onAfterNode } : {}),
            }),
          )
          opts.debug?.onResult(runId, result, Date.now() - startedAt)
          return result
        } catch (err) {
          opts.debug?.onError(runId, err, Date.now() - startedAt)
          throw err
        } finally {
          void scope?.dispose()
        }
      }
      out.push({ workflowPath: wf.relativePath, nodeId, cron, timezone, run })
    }
  }
  return out
}

export interface RunningSchedules {
  schedules: Array<PreparedSchedule & { next: () => Date | null }>
  stop: () => void
}

/**
 * Starts a timer for every schedule in `workflows`. Each run's failure is
 * logged; the schedule carries on.
 */
export function startWorkflowSchedules(
  workflows: LoadedWorkflow[],
  opts: ScheduleRunOptions & { log?: boolean },
): RunningSchedules {
  const handles: ScheduleHandle[] = []
  const schedules: RunningSchedules["schedules"] = []
  for (const s of prepareSchedules(workflows, opts)) {
    const where = `${s.workflowPath}#${s.nodeId}`
    const handle = startSchedule(
      { cron: s.cron, timeZone: s.timezone, run: (at) => s.run(at, false) },
      {
        onError: (err, at) =>
          console.error(`[lorien] ${where}: run scheduled for ${at.toISOString()} failed:`, err),
        onSkip: (at) =>
          console.warn(
            `[lorien] ${where}: skipped the run for ${at.toISOString()}; the previous one is still going`,
          ),
      },
    )
    handles.push(handle)
    schedules.push({ ...s, next: handle.next })
    if (opts.log !== false) {
      const next = handle.next()
      console.log(
        `[lorien] ${where}: ${describeCron(s.cron)} (${s.timezone})${next ? `, next at ${next.toISOString()}` : ""}`,
      )
    }
  }
  return {
    schedules,
    stop: () => {
      for (const h of handles) h.stop()
    },
  }
}

/**
 * `POST /__lorien/schedules/run` with `{ workflowPath, nodeId }` runs that
 * schedule now and answers with the workflow's result. The IDE's Run now.
 */
export function mountScheduleRunner(app: Hono, schedules: PreparedSchedule[]): void {
  app.post(RUN_SCHEDULE_PATH, async (c) => {
    let target: { workflowPath?: unknown; nodeId?: unknown }
    try {
      target = (await c.req.json()) as typeof target
    } catch {
      return c.json({ error: "Expected a JSON body: { workflowPath, nodeId }" }, 400)
    }
    const s = schedules.find(
      (x) => x.workflowPath === target.workflowPath && x.nodeId === target.nodeId,
    )
    if (!s) return c.json({ error: "No valid schedule with that workflow and node id" }, 404)
    try {
      const result = await s.run(new Date(), true)
      return c.json({ ok: true, status: result.status, body: result.body ?? null })
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })
}
