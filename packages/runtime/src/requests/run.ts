import { evaluateAssertions } from "./assert.js"
import { type InterpolationContext, interpolate, interpolateDeep } from "./interpolate.js"
import { readPath } from "./path.js"
import {
  type AssertionResult,
  type NodeMock,
  type RequestRunResult,
  type ResolvedRequest,
  type ResponseSnapshot,
  type RunTrace,
  type SavedRequest,
  TEST_HEADER,
  TRACE_HEADER,
  TRACE_PATH,
} from "./types.js"

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface RunRequestOptions {
  /** e.g. `http://localhost:3000`. A `baseUrl` variable overrides this. */
  baseUrl: string
  vars?: Record<string, string>
  fetch?: FetchLike
}

/** Applies variables and builds the concrete URL, headers and body. */
export function resolveRequest(
  req: SavedRequest,
  opts: { baseUrl: string; vars?: Record<string, string> },
  missing = new Set<string>(),
): ResolvedRequest {
  const ctx: InterpolationContext = { vars: opts.vars ?? {}, missing }
  const base = (opts.vars?.baseUrl ?? opts.baseUrl).replace(/\/+$/, "")
  const path = interpolate(req.path, ctx)
  const url = new URL(
    /^https?:\/\//.test(path) ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`,
  )
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (k) url.searchParams.set(k, interpolate(v, ctx))
  }
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    if (k) headers[k] = interpolate(v, ctx)
  }
  const hasHeader = (name: string) => Object.keys(headers).some((k) => k.toLowerCase() === name)
  let body: string | undefined
  switch (req.body?.kind) {
    case "json":
      body = JSON.stringify(interpolateDeep(req.body.json, ctx))
      if (!hasHeader("content-type")) headers["Content-Type"] = "application/json"
      break
    case "text":
      body = interpolate(req.body.text, ctx)
      if (!hasHeader("content-type")) headers["Content-Type"] = "text/plain"
      break
    case "xml":
      body = interpolate(req.body.text, ctx)
      if (!hasHeader("content-type")) headers["Content-Type"] = "application/xml"
      break
    case "form": {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(req.body.form))
        if (k) params.append(k, interpolate(v, ctx))
      body = params.toString()
      if (!hasHeader("content-type")) headers["Content-Type"] = "application/x-www-form-urlencoded"
      break
    }
  }
  return {
    method: req.method,
    url: url.toString(),
    headers,
    ...(body !== undefined ? { body } : {}),
  }
}

export async function toSnapshot(res: Response, startedAt: number): Promise<ResponseSnapshot> {
  const text = await res.text()
  const durationMs = Date.now() - startedAt
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    headers[k] = v
  })
  let body: unknown = text
  if ((res.headers.get("content-type") ?? "").includes("json") && text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      // Keep the text — a JSON content type with a broken body is itself useful to see.
    }
  }
  return { status: res.status, headers, body, durationMs }
}

function capture(req: SavedRequest, res: ResponseSnapshot): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, from] of Object.entries(req.capture ?? {})) {
    let v: unknown
    if (from === "status") v = res.status
    else if (from.startsWith("header.")) {
      const h = from.slice(7).toLowerCase()
      v = Object.entries(res.headers).find(([k]) => k.toLowerCase() === h)?.[1]
    } else if (from === "body" || from.startsWith("body.") || from.startsWith("body[")) {
      v = readPath(res.body, from.replace(/^body\.?/, "")).value
    }
    if (v !== undefined) out[name] = typeof v === "string" ? v : JSON.stringify(v)
  }
  return out
}

/** True when the request needs the server to apply mocks or record a trace. */
export function needsTrace(req: SavedRequest): boolean {
  return (
    Object.keys(req.mocks ?? {}).length > 0 || (req.expect ?? []).some((a) => a.target === "node")
  )
}

function testHeaderValue(mocks: Record<string, NodeMock>): string {
  return encodeURIComponent(JSON.stringify({ mocks }))
}

async function fetchTrace(
  doFetch: FetchLike,
  requestUrl: string,
  id: string,
): Promise<RunTrace | undefined> {
  try {
    const res = await doFetch(new URL(TRACE_PATH + encodeURIComponent(id), requestUrl).toString(), {
      method: "GET",
    })
    if (!res.ok) return undefined
    const trace = (await res.json()) as RunTrace
    return trace && typeof trace.nodes === "object" ? trace : undefined
  } catch {
    return undefined
  }
}

/**
 * Sends one saved request and checks its assertions. With no `expect` list,
 * a request passes when it gets a non-error (< 400) response.
 */
export async function runSavedRequest(
  req: SavedRequest,
  opts: RunRequestOptions,
): Promise<RequestRunResult> {
  const missing = new Set<string>()
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init))
  let resolved: ResolvedRequest
  try {
    resolved = resolveRequest(req, opts, missing)
  } catch (e) {
    return {
      requestId: req.id,
      name: req.name,
      request: { method: req.method, url: req.path, headers: {} },
      error: `Could not build the request: ${(e as Error).message}`,
      assertions: [],
      captured: {},
      missingVariables: [...missing],
      passed: false,
    }
  }
  const base = {
    requestId: req.id,
    name: req.name,
    request: resolved,
    missingVariables: [...missing],
  }
  const traced = needsTrace(req)
  const mocks = traced
    ? (interpolateDeep(req.mocks ?? {}, { vars: opts.vars ?? {} }) as Record<string, NodeMock>)
    : {}
  let response: ResponseSnapshot
  const startedAt = Date.now()
  try {
    const res = await doFetch(resolved.url, {
      method: resolved.method,
      headers: traced
        ? { ...resolved.headers, [TEST_HEADER]: testHeaderValue(mocks) }
        : resolved.headers,
      ...(resolved.body !== undefined && !["GET", "HEAD"].includes(resolved.method)
        ? { body: resolved.body }
        : {}),
    })
    response = await toSnapshot(res, startedAt)
  } catch (e) {
    return { ...base, error: (e as Error).message, assertions: [], captured: {}, passed: false }
  }
  const traceId = traced ? response.headers[TRACE_HEADER] : undefined
  const trace = traceId ? await fetchTrace(doFetch, resolved.url, traceId) : undefined
  const assertions: AssertionResult[] = evaluateAssertions(req.expect, response, trace)
  const passed =
    req.expect && req.expect.length > 0 ? assertions.every((a) => a.pass) : response.status < 400
  const result: RequestRunResult = {
    ...base,
    response,
    assertions,
    captured: capture(req, response),
    passed,
    ...(trace ? { trace } : {}),
  }
  // A server that ignored the mocks ran the real nodes, so the result can't be trusted.
  if (!trace && Object.keys(mocks).length > 0) {
    result.error =
      "This request has mocks, but the server didn't apply them. Mocks work in the lorien IDE and `lorien test`."
    result.passed = false
  }
  return result
}

export interface RunCollectionOptions extends RunRequestOptions {
  /** Called after each request — for progress UIs. */
  onResult?: (result: RequestRunResult) => void
}

/**
 * Runs requests in order. Values captured by earlier requests are available
 * as variables to later ones (e.g. create a user, then fetch it by id).
 */
export async function runRequests(
  requests: SavedRequest[],
  opts: RunCollectionOptions,
): Promise<RequestRunResult[]> {
  const vars = { ...(opts.vars ?? {}) }
  const results: RequestRunResult[] = []
  for (const req of requests) {
    const r = await runSavedRequest(req, { ...opts, vars })
    Object.assign(vars, r.captured)
    results.push(r)
    opts.onResult?.(r)
  }
  return results
}
