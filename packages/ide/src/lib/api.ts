import type { NodeCaseResult } from "@darrylondil/lorien-runtime/cases"
import type { FileFolder } from "@/data/mock-files"

export interface WorkspaceInfo {
  root: string
  name: string
}

export interface WorkspaceTree {
  workflows: FileFolder
  nodes: FileFolder
  /** Missing from servers older than the providers explorer. */
  providers?: FileFolder
  lib?: FileFolder
}

export interface WorkspaceFile {
  path: string
  content: string
}

/**
 * Error thrown by every workspace API helper. `message` is the human-readable
 * reason (the server's `{ error }` body when it sent one), `status` is the HTTP
 * status, or 0 when the request never reached the server.
 */
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

/**
 * Reads a failed response's `{ error }` body when present so callers can show
 * the server's reason instead of a bare status code.
 */
async function errorFromResponse(res: Response, what: string): Promise<ApiError> {
  let reason: string | undefined
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body?.error === "string" && body.error.length > 0) reason = body.error
  } catch {
    // Non-JSON body — fall through to the generic message.
  }
  return new ApiError(reason ?? `${what} failed (HTTP ${res.status})`, res.status)
}

/** fetch() wrapper that turns network failures into an ApiError with status 0. */
async function request(
  input: string,
  init: RequestInit | undefined,
  what: string,
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (e) {
    throw new ApiError(
      `${what} failed: could not reach the lorien IDE server (${(e as Error).message})`,
      0,
    )
  }
}

async function getJson<T>(url: string, what: string): Promise<T> {
  const res = await request(url, undefined, what)
  if (!res.ok) throw await errorFromResponse(res, what)
  return res.json() as Promise<T>
}

export async function fetchWorkspaceInfo(): Promise<WorkspaceInfo> {
  return getJson<WorkspaceInfo>("/api/workspace/info", "Loading workspace info")
}

export async function fetchWorkspaceTree(): Promise<WorkspaceTree> {
  return getJson<WorkspaceTree>("/api/workspace/tree", "Loading the file tree")
}

export async function fetchFile(path: string): Promise<WorkspaceFile> {
  return getJson<WorkspaceFile>(
    `/api/workspace/file?path=${encodeURIComponent(path)}`,
    `Loading ${path}`,
  )
}

// ── Workflow types (minimal — avoids pulling in the heavy runtime/zod dep) ────

export interface WorkflowFile {
  lorien: 1
  nodes: Record<string, NodeInstance>
  view?: Record<string, { x: number; y: number }>
}

export interface NodeInstance {
  uses: string
  /**
   * References ONLY. Two shapes:
   *  - per-field object:   { fieldName: "nodeId.path", ... } — strings only
   *  - single reference:   "nodeId.path" (whole-object form — the resolved
   *                          value is passed as the node's input)
   */
  in?: string | Record<string, string>
  /**
   * Per-field literal values typed by the user. Any JSON-serializable value;
   * strings are NEVER interpreted as references. `in:` overrides `values:`
   * for the same field at evaluation time.
   */
  values?: Record<string, unknown>
  after?: string[]
  label?: string
}

export async function fetchWorkflowFile(path: string): Promise<WorkflowFile> {
  const { content } = await fetchFile(path)
  return parseWorkflowContent(path, content)
}

/**
 * Parses and shape-checks `.workflow` text. Throws a readable error naming the
 * file (and the JSON parser's reason) instead of a bare SyntaxError.
 */
export function parseWorkflowContent(path: string, content: string): WorkflowFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    throw new ApiError(`${path} is not valid JSON: ${(e as Error).message}`, 422)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(`${path} must contain a JSON object`, 422)
  }
  const nodes = (parsed as { nodes?: unknown }).nodes
  if (typeof nodes !== "object" || nodes === null || Array.isArray(nodes)) {
    throw new ApiError(`${path} is missing its "nodes" object`, 422)
  }
  for (const [id, node] of Object.entries(nodes as Record<string, unknown>)) {
    if (
      typeof node !== "object" ||
      node === null ||
      typeof (node as { uses?: unknown }).uses !== "string"
    ) {
      throw new ApiError(`${path}: node "${id}" is missing a "uses" string`, 422)
    }
  }
  return parsed as WorkflowFile
}

export interface SaveResult {
  path: string
  bytes: number
}

export async function saveFile(path: string, content: string): Promise<SaveResult> {
  const what = `Saving ${path}`
  const res = await request(
    "/api/workspace/file",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, content }),
    },
    what,
  )
  if (!res.ok) throw await errorFromResponse(res, what)
  return res.json() as Promise<SaveResult>
}

// ── Schemas ──────────────────────────────────────────────────────────────────

/**
 * Minimal JSON Schema subset the IDE consumes. Anything not modeled here is
 * tolerated as opaque (treated as a leaf).
 */
export interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  additionalProperties?: boolean | JsonSchema
  enum?: unknown[]
  format?: string
  /** Optional declarative default. May be a template string (e.g. "{workflow_path}"). */
  default?: unknown
  [key: string]: unknown
}

export interface NodeSchemas {
  /** Human-readable display name from defineNode({ name }). Null when unset. */
  name?: string | null
  inputs: JsonSchema
  outputs: JsonSchema
  /** Optional accent color string (e.g. "indigo", "#a78bfa"). */
  color?: string | null
  /** Leading TSDoc/JSDoc extracted from the node source file. Null when absent. */
  description?: string | null
}

export async function fetchWorkspaceSchemas(): Promise<Record<string, NodeSchemas>> {
  const { schemas } = await getJson<{ schemas: Record<string, NodeSchemas> }>(
    "/api/workspace/schemas",
    "Loading node schemas",
  )
  return schemas
}

export type ProviderLifetime = "singleton" | "scoped" | "transient"

export interface ProviderInfo {
  /** The name nodes read it by, e.g. "db". */
  name: string
  /** e.g. "providers/db.ts". */
  path: string
  /** `name` from defineProvider, for display. */
  label?: string
  color?: string
  lifetime: ProviderLifetime
  uses: string[]
  /** Env vars its schema declares; "missing" means the IDE's process doesn't have it. */
  env: { key: string; status: "set" | "default" | "optional" | "missing" }[]
  hasDispose: boolean
  packages: string[]
  /** Node files that read it, e.g. "nodes/pets/add-pet.ts". */
  usedBy: string[]
}

export interface WorkspaceProviders {
  providers: ProviderInfo[]
  /** Node `uses` key ("./nodes/pets/add-pet") → the providers its `run` reads. */
  nodes: Record<string, string[]>
}

export async function fetchWorkspaceProviders(): Promise<WorkspaceProviders> {
  return getJson<WorkspaceProviders>("/api/workspace/providers", "Loading providers")
}

export interface WorkspaceTypeFile {
  /** Virtual path, e.g. "node_modules/zod/index.d.cts". */
  path: string
  content: string
}

/**
 * Declaration files for the workspace's dependencies (and generated
 * `.lorien/types`), so the code editor can resolve package imports.
 */
export async function fetchWorkspaceTypes(): Promise<WorkspaceTypeFile[]> {
  const body = await getJson<{ files: WorkspaceTypeFile[] }>(
    "/api/workspace/types",
    "Loading type definitions",
  )
  return body.files
}

/**
 * Creates a new file at `path` with `content`. Throws if the file already
 * exists (backend returns 409) or if the request fails for any other reason.
 */
export async function createWorkspaceFile(path: string, content: string): Promise<void> {
  const what = `Creating ${path}`
  const res = await request(
    `/api/workspace/file?path=${encodeURIComponent(path)}&create=true`,
    { method: "PUT", body: content },
    what,
  )
  if (res.status === 409) throw new ApiError("File already exists", 409)
  if (!res.ok) throw await errorFromResponse(res, what)
}

/**
 * Creates an empty folder at `path` (mkdir -p semantics). Idempotent.
 */
export async function createWorkspaceFolder(path: string): Promise<void> {
  const what = `Creating folder ${path}`
  const res = await request(
    "/api/workspace/folder",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    },
    what,
  )
  if (!res.ok) throw await errorFromResponse(res, what)
}

// ── Agent broker base URLs ────────────────────────────────────────────────────

/**
 * Base URLs for the lorien dev-server agent broker.
 *
 * In development, the IDE runs on Vite's dev server (e.g. port 5173) while
 * the lorien runtime / broker runs separately (default port 3000). Set
 * `VITE_LORIEN_API_URL` to point at the runtime when they differ.
 */

const DEFAULT_DEV_BASE = "http://localhost:3000"

export function restBase(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> })
    .env
  const viteUrl = typeof env?.VITE_LORIEN_API_URL === "string" ? env.VITE_LORIEN_API_URL : undefined
  // In test environments, vi.stubEnv sets process.env but not import.meta.env
  // (Vite inlines VITE_* at transform time). Fall back to process.env for testability.
  // Accessed via globalThis so the IDE's browser-only tsconfig (no node types)
  // doesn't see a bare `process` reference.
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return resolveRestBase({
    configuredUrl: viteUrl ?? proc?.env?.VITE_LORIEN_API_URL,
    devServer: env?.DEV !== false,
    pageOrigin: (globalThis as { location?: { origin?: string } }).location?.origin,
  })
}

/**
 * Picks the backend base URL. An explicit `VITE_LORIEN_API_URL` always wins.
 * A production bundle is served by `lorien ide`, which hosts the workflows,
 * the debugger socket and the agent broker on its own origin — so it talks to
 * its own origin. Only the Vite dev server reaches across to a separately
 * running backend.
 */
export function resolveRestBase(opts: {
  configuredUrl?: string | undefined
  devServer: boolean
  pageOrigin?: string | undefined
}): string {
  if (opts.configuredUrl) return opts.configuredUrl
  if (!opts.devServer && opts.pageOrigin) return opts.pageOrigin
  return DEFAULT_DEV_BASE
}

export function wsUrl(): string {
  const base = restBase()
  const wsScheme = base.startsWith("https://") ? "wss://" : "ws://"
  // Strip the scheme and any trailing slash so a base URL like
  // `http://host:port/` doesn't produce `ws://host:port//__lorien/...`.
  const host = base.replace(/^https?:\/\//, "").replace(/\/+$/, "")
  return `${wsScheme}${host}/__lorien/agents/ws`
}

export function debugWsUrl(): string {
  const base = restBase()
  const wsScheme = base.startsWith("https://") ? "wss://" : "ws://"
  const host = base.replace(/^https?:\/\//, "").replace(/\/+$/, "")
  return `${wsScheme}${host}/__lorien/debug/ws`
}

// ── Node test cases ───────────────────────────────────────────────────────────

export interface NodeCaseFileRun {
  /** `nodes/users/save-user.cases.json` */
  path: string
  /** `./nodes/users/save-user` */
  uses: string
  error?: string
  results: NodeCaseResult[]
}

export interface NodeTestsRun {
  files: NodeCaseFileRun[]
  /** Anything the nodes printed while running. */
  logs: string
  error?: string
}

/**
 * Runs node cases on the IDE server (in a fresh subprocess, so node edits
 * apply). `only` maps a cases file to the case ids to run.
 */
export async function runNodeTests(req: {
  filter?: string
  only?: Record<string, string[]>
}): Promise<NodeTestsRun> {
  const what = "Running node tests"
  const res = await request(
    "/api/tests/nodes",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) },
    what,
  )
  const body = (await res.json().catch(() => null)) as NodeTestsRun | null
  if (!body) throw new ApiError(`${what} failed (HTTP ${res.status})`, res.status)
  if (!res.ok) throw new ApiError(body.error ?? `${what} failed (HTTP ${res.status})`, res.status)
  return body
}
