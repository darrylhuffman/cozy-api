/**
 * Saved API requests ("request collections") and environments.
 *
 * A collection lives next to the workflow it exercises —
 * `workflows/users/create.workflow` → `workflows/users/create.requests.json` —
 * so it is committed with the code and shared by everyone on the team. The IDE
 * Run tab edits and runs them; `lorien test` and `runRequestCollections` run
 * the same files in CI.
 *
 * Everything in this module is browser-safe (no node: imports).
 */

export const COLLECTION_SUFFIX = ".requests.json"
export const ENVIRONMENTS_FILE = "lorien.environments.json"
/** Git-ignored per-developer overrides (secrets, personal tokens). */
export const LOCAL_ENVIRONMENTS_FILE = "lorien.environments.local.json"

export type RequestBody =
  | { kind: "json"; json: unknown }
  | { kind: "text"; text: string }
  | { kind: "xml"; text: string }
  | { kind: "form"; form: Record<string, string> }

export type AssertionTarget = "status" | "header" | "body" | "duration"

export type AssertionOp =
  | "equals"
  | "notEquals"
  | "contains"
  | "exists"
  | "notExists"
  | "matches"
  | "lessThan"
  | "greaterThan"
  | "type"

export interface Assertion {
  target: AssertionTarget
  /**
   * `header`: the header name (case-insensitive).
   * `body`: a path into the parsed body, e.g. `user.id` or `items[0].name`;
   * omit or leave empty for the whole body.
   */
  path?: string
  op: AssertionOp
  value?: unknown
}

export interface SavedRequest {
  id: string
  name: string
  /** Trigger node id in the workflow this request targets (informational). */
  trigger?: string
  method: string
  /** Path relative to the base URL. May contain `{{variables}}`. */
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: RequestBody
  expect?: Assertion[]
  /**
   * Values to lift out of the response for later requests in the same run,
   * e.g. `{ "userId": "body.user.id" }` makes `{{userId}}` available.
   * Paths start with `body.`, `header.` or are exactly `status`.
   */
  capture?: Record<string, string>
}

export interface RequestCollection {
  lorien: 1
  requests: SavedRequest[]
}

export interface EnvironmentsFile {
  lorien: 1
  default?: string
  environments: Record<string, Record<string, string>>
}

export interface ResolvedRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export interface ResponseSnapshot {
  status: number
  headers: Record<string, string>
  /** Parsed JSON when the response is JSON, otherwise the text. */
  body: unknown
  durationMs: number
}

export interface AssertionResult {
  assertion: Assertion
  pass: boolean
  actual: unknown
  message: string
}

export interface RequestRunResult {
  requestId: string
  name: string
  request: ResolvedRequest
  response?: ResponseSnapshot
  /** Network or setup failure — the request never produced a response. */
  error?: string
  assertions: AssertionResult[]
  /** Variables captured from this response. */
  captured: Record<string, string>
  /** Variables referenced but not defined (left as `{{name}}`). */
  missingVariables: string[]
  passed: boolean
}
