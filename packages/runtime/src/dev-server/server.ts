import type { Context, Hono } from "hono"
import { resolveCoreNode } from "../core/registry.js"
import { LifecycleEmitter } from "../exec/lifecycle.js"
import { runWorkflow, type WorkflowRunResult } from "../exec/run.js"
import { computeExecutionPlan } from "../exec/topology.js"
import type { AnyNodeOrTrigger, Services } from "../types.js"
import { validateWorkflow } from "../workflow/validate.js"
import { withRunContext } from "./console-capture.js"
import type { RequestEnvelope } from "./debug-protocol.js"
import type { LoadedWorkflow } from "./load.js"
import { buildTriggerSlice, extractParams } from "./trigger-slice.js"

export interface DebugIntegration {
  newRunId: () => string
  buildRun: (
    runId: string,
    workflowPath: string,
    triggerNodeId: string,
    request: RequestEnvelope,
  ) => {
    lifecycle: LifecycleEmitter
    onBeforeNode?: (nodeId: string, input: Record<string, unknown>) => Promise<void>
    onAfterNode?: (nodeId: string, output: Record<string, unknown>) => Promise<void>
  }
  onResult: (runId: string, result: WorkflowRunResult, totalMs: number) => void
  onError: (runId: string, err: unknown, totalMs: number) => void
}

export interface MountOptions {
  nodes: Record<string, AnyNodeOrTrigger>
  services: Services
  debug?: DebugIntegration
}

export function mountWorkflows(
  app: Hono,
  workflows: LoadedWorkflow[],
  opts: MountOptions,
): void {
  for (const wf of workflows) {
    const { errors, depsByNode } = validateWorkflow(wf.file)
    if (errors.length > 0) {
      console.error(
        `Skipping ${wf.relativePath}: ${errors.length} validation error(s)`,
      )
      for (const e of errors)
        console.error(`  - ${e.nodeId}.${e.field}: ${e.message}`)
      continue
    }

    for (const [nodeId, inst] of Object.entries(wf.file.nodes)) {
      if (inst.uses !== "@core/http-request") continue
      const values = (inst.values ?? {}) as Record<string, unknown>
      const path = (values.path as string | undefined) ?? "/"
      const method = (
        (values.method as string | undefined) ?? "GET"
      ).toUpperCase()

      const projectedFile = buildTriggerSlice(wf.file, nodeId, depsByNode)
      const { depsByNode: sliceDeps } = validateWorkflow(projectedFile)
      const plan = computeExecutionPlan(projectedFile, sliceDeps)

      const handler = async (c: Context): Promise<Response> => {
        const runId = opts.debug?.newRunId() ?? crypto.randomUUID()
        const startedAt = Date.now()

        let body: unknown = null
        const contentType = c.req.header("content-type") ?? ""
        if (contentType.includes("application/json")) {
          try {
            body = await c.req.json()
          } catch {
            body = null
          }
        } else if (c.req.raw.body) {
          body = await c.req.text()
        }

        const url = new URL(c.req.url)
        const query: Record<string, string> = {}
        url.searchParams.forEach((v, k) => {
          query[k] = v
        })
        const headers: Record<string, string> = {}
        c.req.raw.headers.forEach((v, k) => {
          headers[k] = v
        })

        const request: RequestEnvelope = {
          method: c.req.method,
          path: url.pathname,
          ...(Object.keys(query).length > 0 ? { query } : {}),
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
          ...(body !== null ? { body } : {}),
        }

        const run = opts.debug?.buildRun(runId, wf.relativePath, nodeId, request)

        try {
          const result = await withRunContext(runId, () =>
            runWorkflow({
              workflow: projectedFile,
              plan,
              triggerNodeId: nodeId,
              triggerOutputs: {
                body,
                params: extractParams(path, url.pathname),
                query,
                headers,
                context: { requestId: runId, timestamp: startedAt },
              },
              services: opts.services,
              resolveNode: (uses) =>
                resolveCoreNode(uses) ?? opts.nodes[uses] ?? null,
              ...(run?.lifecycle ? { lifecycle: run.lifecycle } : {}),
              ...(run?.onBeforeNode ? { onBeforeNode: run.onBeforeNode } : {}),
              ...(run?.onAfterNode ? { onAfterNode: run.onAfterNode } : {}),
            }),
          )
          opts.debug?.onResult(runId, result, Date.now() - startedAt)
          return new Response(JSON.stringify(result.body), {
            status: result.status,
            headers: {
              "content-type": "application/json",
              ...result.headers,
            },
          })
        } catch (err) {
          opts.debug?.onError(runId, err, Date.now() - startedAt)
          const msg = err instanceof Error ? err.message : String(err)
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "content-type": "application/json" },
          })
        }
      }

      app.on(method, path, handler)
    }
  }
}
