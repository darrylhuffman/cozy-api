import type { Assertion, RequestBody, SavedRequest } from "@darrylondil/lorien-runtime/requests"
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

export type FormToRequestResult =
  | { request: SavedRequest; error?: undefined }
  | { request?: undefined; error: string }

/**
 * Builds a SavedRequest from the form. JSON bodies must parse — use
 * `"{{variable}}"` inside strings for dynamic values.
 */
export function formToSavedRequest(
  form: RequestForm,
  meta: { id: string; name: string; expect: Assertion[]; capture: Array<[string, string]> },
): FormToRequestResult {
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
  return { request }
}
