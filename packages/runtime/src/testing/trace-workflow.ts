import { resolveCoreNode } from "../core/registry.js"
import { LifecycleEmitter } from "../exec/lifecycle.js"
import { runWorkflow, type WorkflowRunResult } from "../exec/run.js"
import { computeExecutionPlan } from "../exec/topology.js"
import type { WorkflowFile } from "../workflow/types.js"
import { validateWorkflow } from "../workflow/validate.js"
import type { TestWorkflowOptions } from "./test-workflow.js"

export interface NodeTrace {
  nodeId: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  durationMs: number
}

export interface TraceResult {
  response: WorkflowRunResult
  errors: Array<{ nodeId: string; error: Error }>
  at(nodeId: string): NodeTrace
  all(): NodeTrace[]
}

export async function traceWorkflow(
  wf: WorkflowFile,
  opts: TestWorkflowOptions,
): Promise<TraceResult> {
  const { errors, depsByNode } = validateWorkflow(wf)
  if (errors.length > 0) {
    throw new Error(
      `Invalid workflow:\n${errors.map((e) => `  - ${e.nodeId}.${e.field}: ${e.message}`).join("\n")}`,
    )
  }
  const plan = computeExecutionPlan(wf, depsByNode)
  const triggerNodeId = opts.trigger ?? findFirstHttpTrigger(wf)
  if (!triggerNodeId) {
    throw new Error("traceWorkflow: no @core/http-request trigger found in workflow")
  }

  const emitter = new LifecycleEmitter()
  const traces = new Map<string, Partial<NodeTrace>>()
  const traceErrors: Array<{ nodeId: string; error: Error }> = []

  emitter.on("before-node", (e) => {
    traces.set(e.nodeId, { nodeId: e.nodeId, input: e.input })
  })
  emitter.on("after-node", (e) => {
    const t = traces.get(e.nodeId) ?? { nodeId: e.nodeId, input: {} }
    traces.set(e.nodeId, { ...t, output: e.output, durationMs: e.durationMs })
  })
  emitter.on("error", (e) => {
    traceErrors.push({ nodeId: e.nodeId, error: e.error })
  })

  const response = await runWorkflow({
    workflow: wf,
    plan,
    triggerNodeId,
    triggerOutputs: {
      body: opts.request.body,
      params: opts.request.params ?? {},
      query: opts.request.query ?? {},
      headers: opts.request.headers ?? {},
      context: { requestId: `trace-${Math.random().toString(36).slice(2)}`, timestamp: Date.now() },
    },
    services: opts.services ?? {},
    resolveNode: (uses) => resolveCoreNode(uses) ?? opts.nodes?.[uses] ?? null,
    lifecycle: emitter,
  })

  return {
    response,
    errors: traceErrors,
    at(nodeId: string): NodeTrace {
      const t = traces.get(nodeId)
      if (!t?.output) throw new Error(`No trace for node \`${nodeId}\``)
      return t as NodeTrace
    },
    all(): NodeTrace[] {
      return [...traces.values()].filter((t): t is NodeTrace => Boolean(t.output))
    },
  }
}

function findFirstHttpTrigger(wf: WorkflowFile): string | null {
  for (const [id, inst] of Object.entries(wf.nodes)) {
    if (inst.uses === "@core/http-request") return id
  }
  return null
}
