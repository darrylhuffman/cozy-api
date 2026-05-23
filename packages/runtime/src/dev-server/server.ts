import type { Context, Hono } from "hono"
import { resolveCoreNode } from "../core/registry.js"
import type { LifecycleEmitter } from "../exec/lifecycle.js"
import { runWorkflow } from "../exec/run.js"
import { computeExecutionPlan } from "../exec/topology.js"
import type { AnyNodeOrTrigger, Services } from "../types.js"
import type { WorkflowFile } from "../workflow/types.js"
import { validateWorkflow } from "../workflow/validate.js"
import type { LoadedWorkflow } from "./load.js"
import { buildTriggerSlice, extractParams } from "./trigger-slice.js"

export interface MountOptions {
  nodes: Record<string, AnyNodeOrTrigger>
  services: Services
  lifecycle?: LifecycleEmitter
}

export function mountWorkflows(app: Hono, workflows: LoadedWorkflow[], opts: MountOptions): void {
  for (const wf of workflows) {
    const { errors, depsByNode } = validateWorkflow(wf.file)
    if (errors.length > 0) {
      console.error(`Skipping ${wf.relativePath}: ${errors.length} validation error(s)`)
      for (const e of errors) console.error(`  - ${e.nodeId}.${e.field}: ${e.message}`)
      continue
    }

    for (const [nodeId, inst] of Object.entries(wf.file.nodes)) {
      if (inst.uses !== "@core/http-request") continue
      // method/path are user-typed literals — live under `values:`. References
      // in `in:` are resolved per-request and don't apply at mount time.
      const values = (inst.values ?? {}) as Record<string, unknown>
      const path = (values.path as string | undefined) ?? "/"
      const method = ((values.method as string | undefined) ?? "GET").toUpperCase()

      // Build a projected workflow containing only nodes relevant to this trigger.
      // This prevents orphan response nodes from one trigger's subgraph from
      // short-circuiting another trigger's execution in multi-trigger workflows.
      const projectedFile = buildTriggerSlice(wf.file, nodeId, depsByNode)
      const { depsByNode: sliceDeps } = validateWorkflow(projectedFile)
      const plan = computeExecutionPlan(projectedFile, sliceDeps)

      const handler = async (c: Context): Promise<Response> => {
        const reqId = crypto.randomUUID()
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

        const result = await runWorkflow({
          workflow: projectedFile,
          plan,
          triggerNodeId: nodeId,
          triggerOutputs: {
            body,
            params: extractParams(path, url.pathname),
            query,
            headers,
            context: { requestId: reqId, timestamp: Date.now() },
          },
          services: opts.services,
          resolveNode: (uses) => resolveCoreNode(uses) ?? opts.nodes[uses] ?? null,
          ...(opts.lifecycle !== undefined && { lifecycle: opts.lifecycle }),
        })

        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: {
            "content-type": "application/json",
            ...result.headers,
          },
        })
      }

      app.on(method, path, handler)
    }
  }
}
