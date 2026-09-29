import type { RequestEnvelope } from "@darrylondil/lorien-runtime"
import {
  type RequestRunResult,
  runRequests,
  runSavedRequest,
  type SavedRequest,
} from "@darrylondil/lorien-runtime/requests"
import { restBase } from "@/lib/api"
import { useRequestHistoryStore } from "@/store/request-history"

function envelopeFor(r: RequestRunResult): RequestEnvelope {
  let path = r.request.url
  let query: Record<string, string> | undefined
  try {
    const u = new URL(r.request.url)
    path = u.pathname
    if (u.searchParams.size > 0) query = Object.fromEntries(u.searchParams)
  } catch {
    // keep the raw url
  }
  let body: unknown = r.request.body
  if (typeof body === "string") {
    try {
      body = JSON.parse(body)
    } catch {
      // not JSON — keep the text
    }
  }
  return {
    method: r.request.method,
    path,
    ...(query ? { query } : {}),
    ...(Object.keys(r.request.headers).length > 0 ? { headers: r.request.headers } : {}),
    ...(body !== undefined ? { body } : {}),
  }
}

/** Mirrors a finished run into the Run tab's history list. */
function record(
  workflowPath: string,
  triggerNodeId: string,
  r: RequestRunResult,
  startedAt: number,
) {
  const history = useRequestHistoryStore.getState()
  const id = history.addEntry({ workflowPath, triggerNodeId, request: envelopeFor(r), startedAt })
  if (r.response) {
    const { status, headers, body, durationMs } = r.response
    history.setResponse(id, { status, headers, body, durationMs })
  } else {
    history.setError(id, r.error ?? "request failed")
  }
}

/**
 * Sends a request to the workflow server (the IDE's own origin unless the
 * environment sets `baseUrl`), checks its assertions and logs it to history.
 */
export async function sendRequest(
  req: SavedRequest,
  ctx: { workflowPath: string; vars: Record<string, string> },
): Promise<RequestRunResult> {
  const startedAt = Date.now()
  const result = await runSavedRequest(req, { baseUrl: restBase(), vars: ctx.vars })
  record(ctx.workflowPath, req.trigger ?? "", result, startedAt)
  return result
}

/** Runs requests in order, passing captured values forward. */
export async function sendAll(
  requests: SavedRequest[],
  ctx: {
    workflowPath: string
    vars: Record<string, string>
    onResult: (r: RequestRunResult) => void
  },
): Promise<RequestRunResult[]> {
  let startedAt = Date.now()
  return runRequests(requests, {
    baseUrl: restBase(),
    vars: ctx.vars,
    onResult: (r) => {
      const req = requests.find((q) => q.id === r.requestId)
      record(ctx.workflowPath, req?.trigger ?? "", r, startedAt)
      startedAt = Date.now()
      ctx.onResult(r)
    },
  })
}
