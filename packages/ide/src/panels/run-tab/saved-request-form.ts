import type {
  Assertion,
  NodeMock,
  RequestBody,
  SavedRequest,
} from "@darrylondil/lorien-runtime/requests"
import type { DebugSessionState } from "@/store/debug-session"

export type RequestForm = DebugSessionState["requestForm"]

const toPairs = (m: Record<string, string> | undefined): Array<[string, string]> =>
  Object.entries(m ?? {})

const toMap = (pairs: Array<[string, string]>): Record<string, string> | undefined => {
  const kept = pairs.filter(([k]) => k.trim().length > 0)
  return kept.length > 0 ? Object.fromEntries(kept) : undefined
}

/** Loads a saved request into the Run tab's form fields. */
export function savedRequestToForm(req: SavedRequest, triggerNodeId: string | null): RequestForm {
  const body = req.body
  return {
    triggerNodeId: req.trigger ?? triggerNodeId,
    method: req.method,
    path: req.path,
    bodyKind: body?.kind ?? "none",
    body:
      body?.kind === "json"
        ? JSON.stringify(body.json, null, 2)
        : body?.kind === "text" || body?.kind === "xml"
          ? body.text
          : "",
    formBody: body?.kind === "form" ? toPairs(body.form) : [],
    query: toPairs(req.query),
    headers: toPairs(req.headers),
  }
}

/** One row of the Mocks editor: the node, whether it returns or throws, and the text typed. */
export interface MockRow {
  node: string
  kind: "output" | "error"
  /** JSON object for `output`, the message for `error`. */
  text: string
}

export function mocksToRows(mocks: Record<string, NodeMock> | undefined): MockRow[] {
  return Object.entries(mocks ?? {}).map(([node, m]) =>
    m.error !== undefined
      ? { node, kind: "error", text: m.error }
      : { node, kind: "output", text: JSON.stringify(m.output ?? {}) },
  )
}

export function rowsToMocks(
  rows: MockRow[],
): { mocks: Record<string, NodeMock> | undefined; error?: undefined } | { error: string } {
  const mocks: Record<string, NodeMock> = {}
  for (const row of rows) {
    const node = row.node.trim()
    if (!node) continue
    if (row.kind === "error") {
      mocks[node] = { error: row.text }
      continue
    }
    let output: unknown
    try {
      output = JSON.parse(row.text.trim() || "{}")
    } catch (e) {
      return { error: `Mock for ${node} is not valid JSON (${(e as Error).message}).` }
    }
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      return { error: `Mock for ${node} must be a JSON object of the node's outputs.` }
    }
    mocks[node] = { output: output as Record<string, unknown> }
  }
  return { mocks: Object.keys(mocks).length > 0 ? mocks : undefined }
}

export type FormToRequestResult =
  | { request: SavedRequest; error?: undefined }
  | { request?: undefined; error: string }

/**
 * Builds a SavedRequest from the form. JSON bodies must parse — use
 * `"{{variable}}"` inside strings for dynamic values.
 */
export function formToSavedRequest(
  form: RequestForm,
  meta: {
    id: string
    name: string
    expect: Assertion[]
    capture: Array<[string, string]>
    mocks?: MockRow[]
  },
): FormToRequestResult {
  const mocked = rowsToMocks(meta.mocks ?? [])
  if (mocked.error !== undefined) return { error: mocked.error }
  let body: RequestBody | undefined
  switch (form.bodyKind) {
    case "json": {
      const text = form.body.trim()
      if (text.length > 0) {
        try {
          body = { kind: "json", json: JSON.parse(text) }
        } catch (e) {
          return {
            error: `Body is not valid JSON (${(e as Error).message}). Put variables inside strings: "{{name}}".`,
          }
        }
      }
      break
    }
    case "text":
    case "xml":
      if (form.body.length > 0) body = { kind: form.bodyKind, text: form.body }
      break
    case "form": {
      const map = toMap(form.formBody)
      if (map) body = { kind: "form", form: map }
      break
    }
  }
  const request: SavedRequest = {
    id: meta.id,
    name: meta.name.trim() || `${form.method} ${form.path}`,
    method: form.method,
    path: form.path,
  }
  if (form.triggerNodeId) request.trigger = form.triggerNodeId
  const query = toMap(form.query)
  if (query) request.query = query
  const headers = toMap(form.headers)
  if (headers) request.headers = headers
  if (body) request.body = body
  if (meta.expect.length > 0) request.expect = meta.expect
  const capture = toMap(meta.capture)
  if (capture) request.capture = capture
  if (mocked.mocks) request.mocks = mocked.mocks
  return { request }
}
