import type { Context, Hono } from "hono"
import { resolveCoreNode } from "../core/registry.js"
import type { LifecycleEmitter } from "../exec/lifecycle.js"
import { runWorkflow } from "../exec/run.js"
import { computeExecutionPlan } from "../exec/topology.js"
import type { AnyNodeOrTrigger, Services } from "../types.js"
import type { WorkflowFile } from "../workflow/types.js"
import { validateWorkflow } from "../workflow/validate.js"
import type { LoadedWorkflow } from "./load.js"

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

/**
 * Build a workflow slice containing only the nodes relevant to a given trigger.
 *
 * Includes:
 * - The trigger node itself
 * - All nodes forward-reachable from the trigger (explicit subgraph)
 * - Orphan nodes (no trigger owns them) that are NOT @core/response nodes,
 *   unless the trigger's direct subgraph contains no response node at all
 *   (in that case orphan response nodes are included so the trigger still has
 *   a way to produce a response).
 *
 * This prevents a floating @core/response (e.g., one using only $literal values)
 * from short-circuiting a different trigger's response in multi-trigger workflows.
 */
function buildTriggerSlice(
  wf: WorkflowFile,
  triggerNodeId: string,
  depsByNode: Map<string, Set<string>>,
): WorkflowFile {
  const allIds = Object.keys(wf.nodes)

  // Build downstream adjacency from deps.
  const downstreamOf = new Map<string, Set<string>>()
  for (const id of allIds) downstreamOf.set(id, new Set())
  for (const [id, deps] of depsByNode) {
    for (const dep of deps) {
      downstreamOf.get(dep)?.add(id)
    }
  }

  // BFS forward from all trigger nodes to compute each trigger's reachable set.
  const allTriggerIds = allIds.filter((id) => wf.nodes[id]?.uses === "@core/http-request")

  const reachableFrom = new Map<string, Set<string>>()
  for (const tid of allTriggerIds) {
    const reachable = new Set<string>([tid])
    const queue = [tid]
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const next of downstreamOf.get(cur) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next)
          queue.push(next)
        }
      }
    }
    reachableFrom.set(tid, reachable)
  }

  // Determine which nodes are "owned" by at least one trigger.
  const ownedByAnyTrigger = new Set<string>()
  for (const reachable of reachableFrom.values()) {
    for (const id of reachable) ownedByAnyTrigger.add(id)
  }

  const triggerReachable = reachableFrom.get(triggerNodeId) ?? new Set([triggerNodeId])

  // Check if the trigger already has a @core/response node in its explicit subgraph.
  const hasExplicitResponse = [...triggerReachable].some(
    (id) => id !== triggerNodeId && wf.nodes[id]?.uses === "@core/response",
  )

  // Build the included node set.
  const included = new Set<string>()
  for (const id of allIds) {
    if (triggerReachable.has(id)) {
      // Always include nodes in the trigger's explicit subgraph.
      included.add(id)
    } else if (!ownedByAnyTrigger.has(id)) {
      // Orphan node: include unless it's a response node and we already have one.
      const isResponse = wf.nodes[id]?.uses === "@core/response"
      if (!isResponse || !hasExplicitResponse) {
        included.add(id)
      }
    }
    // Nodes owned by OTHER triggers are excluded.
  }

  // Project the workflow to only the included nodes.
  const nodes: WorkflowFile["nodes"] = {}
  for (const id of included) {
    nodes[id] = wf.nodes[id]!
  }

  return { lorien: 1, nodes }
}

/** Extracts :param values from a Hono-style path against an actual pathname. */
function extractParams(template: string, actual: string): Record<string, string> {
  const tParts = template.split("/").filter(Boolean)
  const aParts = actual.split("/").filter(Boolean)
  if (tParts.length !== aParts.length) return {}
  const params: Record<string, string> = {}
  for (let i = 0; i < tParts.length; i++) {
    const t = tParts[i]!
    const a = aParts[i]!
    if (t.startsWith(":")) params[t.slice(1)] = decodeURIComponent(a)
  }
  return params
}
