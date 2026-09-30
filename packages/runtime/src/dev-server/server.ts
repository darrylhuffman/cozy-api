import type { Context, Hono, MiddlewareHandler } from "hono"
import { resolveCoreNode } from "../core/registry.js"
import { RequestValidationError } from "../exec/errors.js"
import { LifecycleEmitter } from "../exec/lifecycle.js"
import { runWorkflow, type WorkflowRunResult } from "../exec/run.js"
import { computeExecutionPlan } from "../exec/topology.js"
import type { Middleware } from "../middleware/define-middleware.js"
import { middlewareChain } from "../middleware/load.js"
import type { ProviderContainer } from "../providers/container.js"
import {
  type NodeMock,
  type RunTrace,
  TEST_HEADER,
  TRACE_HEADER,
  TRACE_PATH,
} from "../requests/types.js"
import type { AnyNodeOrTrigger, Services } from "../types.js"
import { findRouteConflicts, workflowRoutes } from "../workflow/routes.js"
import { validateWorkflow } from "../workflow/validate.js"
import { checkWiring } from "../workflow/wiring.js"
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
  /**
   * Middleware by the folder it guards ("workflows", "workflows/admin"), from
   * `_middleware.ts` files. Each route runs its folders' middleware, outermost
   * first, before the workflow.
   */
  middleware?: Record<string, Middleware[]>
}

/** Where the leading middleware keeps the request's provider scope for the rest of the chain. */
const SCOPE_KEY = "lorien.scope"
/** The request id middleware's scope was opened with, so the run uses the same one. */
const RUN_ID_KEY = "lorien.runId"
/** Set once the workflow handler starts, so the leading middleware knows whether it ran. */
const HANDLED_KEY = "lorien.handled"
type Scope = Awaited<ReturnType<ProviderContainer["open"]>>

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

  // A route served twice would silently go to whichever registered first:
  // mount neither, and say which files clash.
  const clashing = new Set<string>()
  for (const conflict of findRouteConflicts(workflows)) {
    console.error(
      `[lorien] ${conflict.method} ${conflict.path} is served by more than one workflow; skipping all of them: ${conflict.sources.join(", ")}`,
    )
    for (const source of conflict.sources) clashing.add(source)
  }

  for (const wf of workflows) {
    const { errors: shapeErrors, depsByNode } = validateWorkflow(wf.file)
    // Wiring needs the shape to be valid first (references to real nodes).
    const errors =
      shapeErrors.length > 0
        ? shapeErrors
        : checkWiring(wf.file, (uses) => resolveCoreNode(uses) ?? opts.nodes[uses] ?? null)
    if (errors.length > 0) {
      console.error(`Skipping ${wf.relativePath}: ${errors.length} validation error(s)`)
      for (const e of errors) console.error(`  - ${e.nodeId}.${e.field}: ${e.message}`)
      continue
    }

    for (const { nodeId, method, path } of workflowRoutes(wf.file, wf.relativePath)) {
      if (clashing.has(`${wf.relativePath}#${nodeId}`)) continue

      const projectedFile = buildTriggerSlice(wf.file, nodeId, depsByNode)
      const { depsByNode: sliceDeps } = validateWorkflow(projectedFile)
      const plan = computeExecutionPlan(projectedFile, sliceDeps)

      const handler = async (c: Context): Promise<Response> => {
        c.set(HANDLED_KEY as never, true as never)
        const runId =
          (c.get(RUN_ID_KEY as never) as string | undefined) ??
          opts.debug?.newRunId() ??
          crypto.randomUUID()
        const startedAt = Date.now()

        let body: unknown = null
        const contentType = c.req.header("content-type") ?? ""
        if (contentType.includes("application/json")) {
          const text = await c.req.text()
          if (text.trim() !== "") {
            try {
              body = JSON.parse(text)
            } catch {
              return c.json(
                {
                  error: "Invalid request",
                  issues: [{ path: "body", message: "Body is not valid JSON" }],
                },
                400,
              )
            }
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
            // A mock for a renamed or deleted node would silently let the real node run.
            const unknown = Object.keys(test.mocks).filter((id) => !wf.file.nodes[id])
            if (unknown.length > 0)
              throw new Error(`mocks name nodes this workflow doesn't have: ${unknown.join(", ")}`)
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

        // Middleware already opened this request's scope; share it.
        const shared = c.get(SCOPE_KEY as never) as Scope | undefined
        let scope: Scope | null = null
        try {
          scope =
            shared ??
            (opts.providers
              ? await opts.providers.open({ requestId: runId, timestamp: startedAt })
              : null)
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
          // c.newResponse keeps headers middleware set with c.header() before next().
          return c.newResponse(JSON.stringify(result.body), result.status as never, {
            "content-type": "application/json",
            ...result.headers,
            ...traceHeaders(),
          })
        } catch (err) {
          opts.debug?.onError(runId, err, Date.now() - startedAt)
          if (err instanceof RequestValidationError) {
            return c.newResponse(
              JSON.stringify({ error: "Invalid request", issues: err.issues }),
              400,
              { "content-type": "application/json", ...traceHeaders() },
            )
          }
          // Same body as a built server's, plus the message as `detail` so it's
          // readable while developing. Built servers log it instead of sending it.
          console.error(`[lorien] ${method} ${url.pathname} failed:`, err)
          const detail = err instanceof Error ? err.message : String(err)
          return c.newResponse(JSON.stringify({ error: "Internal Server Error", detail }), 500, {
            "content-type": "application/json",
            ...traceHeaders(),
          })
        } finally {
          if (!shared) void scope?.dispose()
        }
      }

      const chain = middlewareChain(
        wf.relativePath,
        Object.entries(opts.middleware ?? {}).map(([dir, list]) => ({ dir, list })),
      ).flatMap((m) => m.list)
      if (chain.length === 0) {
        app.on(method, path, handler)
        continue
      }
      // One provider scope for the whole request: middleware and nodes share
      // scoped providers (the same request logger), disposed at the end.
      const openScope: MiddlewareHandler = async (c, next) => {
        const runId = opts.debug?.newRunId() ?? crypto.randomUUID()
        c.set(RUN_ID_KEY as never, runId as never)
        const scope = opts.providers
          ? await opts.providers.open({ requestId: runId, timestamp: Date.now() })
          : null
        c.set(SCOPE_KEY as never, (scope ?? { values: opts.services ?? {} }) as never)
        try {
          await next()
        } finally {
          void scope?.dispose()
        }
        // Middleware answered before the workflow ran: no node ran, and a test
        // checking that ("CreateBook did not run") still gets a trace to read.
        if (
          opts.testHooks &&
          c.req.header(TEST_HEADER) !== undefined &&
          !c.get(HANDLED_KEY as never)
        ) {
          keepTrace(runId, { nodes: {} })
          c.res.headers.set(TRACE_HEADER, runId)
        }
      }
      const run = chain.map(
        (m): MiddlewareHandler =>
          async (c, next) => {
            const scope = c.get(SCOPE_KEY as never) as Scope
            const res = await m.run(c, next, scope.values as Services)
            return res instanceof Response ? res : undefined
          },
      )
      app.on(method, path, openScope, ...run, handler)
    }
  }
}
