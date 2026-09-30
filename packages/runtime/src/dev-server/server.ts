import type { Context, Hono } from "hono"
import { resolveCoreNode } from "../core/registry.js"
import { LifecycleEmitter } from "../exec/lifecycle.js"
import { runWorkflow, type WorkflowRunResult } from "../exec/run.js"
import { computeExecutionPlan } from "../exec/topology.js"
import type { ProviderContainer } from "../providers/container.js"
import {
  type NodeMock,
  type RunTrace,
  TEST_HEADER,
  TRACE_HEADER,
  TRACE_PATH,
} from "../requests/types.js"
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
  /** Opens a provider scope per request. Takes precedence over `services`. */
  providers?: ProviderContainer
  /** A fixed services bag, used when there is no `providers` container. */
  services?: Services
  debug?: DebugIntegration
  /**
   * Honour the `x-lorien-test` header: apply its node mocks and record a trace
   * served at `/__lorien/traces/:id`. For the IDE and `lorien test` only;
   * never turn this on for a deployed server.
   */
  testHooks?: boolean
}

/** How many traces to keep; a test fetches its trace straight after the response. */
const MAX_TRACES = 200

function parseTestHeader(raw: string): { mocks: Record<string, NodeMock> } {
  const parsed = JSON.parse(decodeURIComponent(raw)) as { mocks?: unknown }
  const mocks = parsed?.mocks
  if (mocks !== undefined && (typeof mocks !== "object" || mocks === null || Array.isArray(mocks)))
    throw new Error("mocks must be an object")
  return { mocks: (mocks ?? {}) as Record<string, NodeMock> }
}

/** Records what each node received, returned or threw during one run. */
function recordTrace(
  lifecycle: LifecycleEmitter,
  mocks: Record<string, NodeMock>,
): { trace: RunTrace; stop: () => void } {
  const trace: RunTrace = { nodes: {} }
  const offs = [
    lifecycle.on("before-node", (e) => {
      trace.nodes[e.nodeId] = { input: e.input, ...(mocks[e.nodeId] ? { mocked: true } : {}) }
    }),
    lifecycle.on("after-node", (e) => {
      const entry = trace.nodes[e.nodeId]
      if (entry) entry.output = e.output
    }),
    lifecycle.on("error", (e) => {
      const entry = trace.nodes[e.nodeId]
      if (entry) entry.error = e.error?.message ?? String(e.error)
    }),
  ]
  return {
    trace,
    stop: () => {
      for (const off of offs) off()
    },
  }
}

export function mountWorkflows(app: Hono, workflows: LoadedWorkflow[], opts: MountOptions): void {
  const traces = new Map<string, RunTrace>()
  if (opts.testHooks) {
    app.get(`${TRACE_PATH}:id`, (c) => {
      const trace = traces.get(c.req.param("id"))
      return trace ? c.json(trace) : c.json({ error: "trace not found" }, 404)
    })
  }
  const keepTrace = (id: string, trace: RunTrace) => {
    traces.set(id, trace)
    if (traces.size > MAX_TRACES) traces.delete(traces.keys().next().value as string)
  }

  for (const wf of workflows) {
    const { errors, depsByNode } = validateWorkflow(wf.file)
    if (errors.length > 0) {
      console.error(`Skipping ${wf.relativePath}: ${errors.length} validation error(s)`)
      for (const e of errors) console.error(`  - ${e.nodeId}.${e.field}: ${e.message}`)
      continue
    }

    for (const [nodeId, inst] of Object.entries(wf.file.nodes)) {
      if (inst.uses !== "@core/http-request") continue
      const values = (inst.values ?? {}) as Record<string, unknown>
      const path = (values.path as string | undefined) ?? "/"
      const method = ((values.method as string | undefined) ?? "GET").toUpperCase()

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

        // Test hooks: mocks in, trace out. Ignored entirely unless enabled.
        let test: { mocks: Record<string, NodeMock> } | null = null
        const testHeader = headers[TEST_HEADER]
        delete headers[TEST_HEADER]
        if (opts.testHooks && testHeader !== undefined) {
          try {
            test = parseTestHeader(testHeader)
          } catch (e) {
            return new Response(
              JSON.stringify({ error: `Bad ${TEST_HEADER} header: ${(e as Error).message}` }),
              { status: 400, headers: { "content-type": "application/json" } },
            )
          }
        }

        const request: RequestEnvelope = {
          method: c.req.method,
          path: url.pathname,
          ...(Object.keys(query).length > 0 ? { query } : {}),
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
          ...(body !== null ? { body } : {}),
        }

        const run = opts.debug?.buildRun(runId, wf.relativePath, nodeId, request)
        const lifecycle = run?.lifecycle ?? (test ? new LifecycleEmitter() : undefined)
        const recorder = test && lifecycle ? recordTrace(lifecycle, test.mocks) : null
        const traceHeaders = (): Record<string, string> => {
          if (!recorder) return {}
          recorder.stop()
          keepTrace(runId, recorder.trace)
          return { [TRACE_HEADER]: runId }
        }

        let scope: Awaited<ReturnType<ProviderContainer["open"]>> | null = null
        try {
          scope = opts.providers
            ? await opts.providers.open({ requestId: runId, timestamp: startedAt })
            : null
          const services = (scope?.values ?? opts.services ?? {}) as Services
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
              services,
              resolveNode: (uses) => resolveCoreNode(uses) ?? opts.nodes[uses] ?? null,
              ...(lifecycle ? { lifecycle } : {}),
              ...(test ? { mocks: test.mocks } : {}),
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
              ...traceHeaders(),
            },
          })
        } catch (err) {
          opts.debug?.onError(runId, err, Date.now() - startedAt)
          const msg = err instanceof Error ? err.message : String(err)
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "content-type": "application/json", ...traceHeaders() },
          })
        } finally {
          void scope?.dispose()
        }
      }

      app.on(method, path, handler)
    }
  }
}
