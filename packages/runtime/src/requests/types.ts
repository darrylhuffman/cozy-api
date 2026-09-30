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

/**
 * Sent with a request that has mocks or node checks. The value is
 * `encodeURIComponent(JSON.stringify({ mocks }))`. Servers started with
 * `testHooks` apply the mocks, record what each node received and returned,
 * and answer with `TRACE_HEADER`; other servers ignore it.
 */
export const TEST_HEADER = "x-lorien-test"
/** Response header naming the recorded trace; fetch it from `TRACE_PATH + id`. */
export const TRACE_HEADER = "x-lorien-trace"
export const TRACE_PATH = "/__lorien/traces/"

export type AssertionTarget = "status" | "header" | "body" | "duration" | "node"

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
   * `node`: a path into what the node did — `input.name`, `output.pet.id` or
   * `error`; omit to check whether the node ran at all (`exists`/`notExists`).
   */
  path?: string
  /** `node` checks only: the node id in the workflow, e.g. `AddPet`. */
  node?: string
  op: AssertionOp
  value?: unknown
}

/**
 * Replaces a node's `run()` for one request: it returns `output` instead, or
 * throws `error`. The node's inputs are still resolved and validated.
 */
export interface NodeMock {
  output?: Record<string, unknown>
  error?: string
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
  /** Node id → what it returns (or throws) instead of running, for this request only. */
  mocks?: Record<string, NodeMock>
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

/** What one node did during a traced request. A node that never ran has no entry. */
export interface NodeTraceEntry {
  input: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
  /** True when a mock stood in for the node's `run()`. */
  mocked?: boolean
}

export interface RunTrace {
  nodes: Record<string, NodeTraceEntry>
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
  /** What each node did, when the request had mocks or node checks. */
  trace?: RunTrace
  /** Variables referenced but not defined (left as `{{name}}`). */
  missingVariables: string[]
  passed: boolean
}
