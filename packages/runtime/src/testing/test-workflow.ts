import { resolveCoreNode } from "../core/registry.js"
import { runWorkflow, type WorkflowRunResult } from "../exec/run.js"
import { computeExecutionPlan } from "../exec/topology.js"
import type { AnyNodeOrTrigger, MockProviders, Services } from "../types.js"
import type { SubworkflowMap } from "../workflow/flatten.js"
import { flattenWorkflow } from "../workflow/flatten.js"
import type { WorkflowFile } from "../workflow/types.js"
import { validateWorkflow } from "../workflow/validate.js"

export interface RequestInput {
  /** The parsed body; `null` when omitted, like a request without one. */
  body?: unknown
  params?: Record<string, string>
  query?: Record<string, string>
  headers?: Record<string, string>
}

export interface TestWorkflowOptions {
  request: RequestInput
  nodes?: Record<string, AnyNodeOrTrigger>
  services?: MockProviders
  /**
   * The project's sub-workflows (`loadSubworkflows(root)`), when the workflow
   * uses any. A file from `loadWorkflowFile` is already flattened and needs none.
   */
  subworkflows?: SubworkflowMap
  /** Specify which trigger node to fire when the workflow has multiple. Defaults to the first @core/http-request found. */
  trigger?: string
}

export async function testWorkflow(
  source: WorkflowFile,
  opts: TestWorkflowOptions,
): Promise<WorkflowRunResult> {
  const wf = opts.subworkflows ? flattenWorkflow(source, opts.subworkflows) : source
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
      body: opts.request.body ?? null,
      params: opts.request.params ?? {},
      query: opts.request.query ?? {},
      headers: opts.request.headers ?? {},
      context: { requestId: `test-${Math.random().toString(36).slice(2)}`, timestamp: Date.now() },
    },
    services: (opts.services ?? {}) as Services,
    resolveNode: (uses) => resolveCoreNode(uses) ?? opts.nodes?.[uses] ?? null,
  })
}

function findFirstHttpTrigger(wf: WorkflowFile): string | null {
  for (const [id, inst] of Object.entries(wf.nodes)) {
    if (inst.uses === "@core/http-request") return id
  }
  return null
}
