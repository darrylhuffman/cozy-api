import { resolveCoreNode } from "../core/registry.js"
import { runWorkflow, type WorkflowRunResult } from "../exec/run.js"
import { computeExecutionPlan } from "../exec/topology.js"
import type { AnyNodeOrTrigger, Services } from "../types.js"
import type { WorkflowFile } from "../workflow/types.js"
import { validateWorkflow } from "../workflow/validate.js"

export interface RequestInput {
  body: unknown
  params?: Record<string, string>
  query?: Record<string, string>
  headers?: Record<string, string>
}

export interface TestWorkflowOptions {
  request: RequestInput
  nodes?: Record<string, AnyNodeOrTrigger>
  services?: Services
  /** Specify which trigger node to fire when the workflow has multiple. Defaults to the first @core/http-request found. */
  trigger?: string
}

export async function testWorkflow(
  wf: WorkflowFile,
  opts: TestWorkflowOptions,
): Promise<WorkflowRunResult> {
  const { errors, depsByNode } = validateWorkflow(wf)
  if (errors.length > 0) {
    throw new Error(
      `Invalid workflow:\n${errors.map((e) => `  - ${e.nodeId}.${e.field}: ${e.message}`).join("\n")}`,
    )
  }
  const plan = computeExecutionPlan(wf, depsByNode)
  const triggerNodeId = opts.trigger ?? findFirstHttpTrigger(wf)
  if (!triggerNodeId) {
    throw new Error("testWorkflow: no @core/http-request trigger found in workflow")
  }

  return runWorkflow({
    workflow: wf,
    plan,
    triggerNodeId,
    triggerOutputs: {
      body: opts.request.body,
      params: opts.request.params ?? {},
      query: opts.request.query ?? {},
      headers: opts.request.headers ?? {},
      context: { requestId: `test-${Math.random().toString(36).slice(2)}`, timestamp: Date.now() },
    },
    services: opts.services ?? {},
    resolveNode: (uses) => resolveCoreNode(uses) ?? opts.nodes?.[uses] ?? null,
  })
}

function findFirstHttpTrigger(wf: WorkflowFile): string | null {
  for (const [id, inst] of Object.entries(wf.nodes)) {
    if (inst.uses === "@core/http-request") return id
  }
  return null
}
