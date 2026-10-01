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
  /** Runs the node only when this reference is truthy ("Room.found"), or falsy with a leading "!". */
  when?: string
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
  /** Set when the node is a sub-workflow: a `.workflow` file under `nodes/`. */
  subworkflow?: SubworkflowInfo
}

export interface SubworkflowInfo {
  /** e.g. "nodes/orders/reserve-seats.workflow". */
  path: string
  /** Statuses its Response nodes can answer with, ascending. */
  respondsWith: number[]
  /** Nodes inside it, not counting its Input and Output. */
  nodeCount: number
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
  /** The doc comment above its defineProvider, for display. */
  description?: string
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

export interface MiddlewareInfo {
  /** The folder it guards, e.g. "workflows/admin". */
  dir: string
  /** e.g. "workflows/admin/_middleware.ts". */
  path: string
  /** Each exported middleware's name (null when unnamed), in run order. */
  names: (string | null)[]
  /** Providers its `run` reads. */
  reads: string[]
}

export interface WorkspaceProviders {
  providers: ProviderInfo[]
  /** Every `_middleware.ts`, outermost folder first. Missing from older servers. */
  middleware?: MiddlewareInfo[]
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

/**
 * Renames a workflow or node file. Its saved requests / test cases move with
 * it, and a renamed node's `uses` are rewritten in every workflow.
 */
export async function renameWorkspaceItem(
  from: string,
  to: string,
): Promise<{ moved: Array<[string, string]>; updatedWorkflows: string[] }> {
  const what = `Renaming ${from}`
  const res = await request(
    "/api/workspace/rename",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to }),
    },
    what,
  )
  if (!res.ok) throw await errorFromResponse(res, what)
  return res.json()
}

/** Deletes a workflow or node file along with its saved requests / test cases. */
export async function deleteWorkspaceItem(path: string): Promise<{ deleted: string[] }> {
  const what = `Deleting ${path}`
  const res = await request(
    `/api/workspace/file?path=${encodeURIComponent(path)}`,
    { method: "DELETE" },
    what,
  )
  if (!res.ok) throw await errorFromResponse(res, what)
  return res.json()
}

/** Workflows that use the node at `path`. */
export async function fetchItemUsage(path: string): Promise<{ usedBy: string[] }> {
  const what = `Checking where ${path} is used`
  const res = await request(`/api/workspace/usage?path=${encodeURIComponent(path)}`, {}, what)
  if (!res.ok) throw await errorFromResponse(res, what)
  return res.json()
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

// ── Git (Source Control panel) ───────────────────────────────────────────────

export interface GitFileChange {
  /** Path relative to the workspace root. */
  path: string
  /** M modified, A added, D deleted, R renamed, U untracked (new, not yet staged), C in conflict. */
  status: "M" | "A" | "D" | "R" | "U" | "C"
  from?: string
}

export type GitStatus =
  | { repo: false }
  | {
      repo: true
      branch: string | null
      upstream: string | null
      ahead: number
      behind: number
      staged: GitFileChange[]
      changes: GitFileChange[]
      stagedElsewhere: number
      /** Files a merge left for a person to resolve. */
      conflicts: GitConflict[]
      conflictsElsewhere: number
      /** Set while a merge waits to be committed. */
      merging: { branch: string | null; message: string } | null
      /** The commit the branch points at, or null before the first commit. */
      head: { hash: string; subject: string } | null
    }

/** A `git stash` entry; stashes belong to the whole repository. */
export interface GitStash {
  /** 0 for the newest. */
  index: number
  message: string
  /** Unix seconds. */
  time: number
}

export type ConflictSide = "modified" | "added" | "deleted"

export interface GitConflict {
  path: string
  ours: ConflictSide
  theirs: ConflictSide
}

export interface GitBranch {
  /** "main", or "origin/main" for a remote branch. */
  name: string
  remote: boolean
  current: boolean
  upstream: string | null
  ahead: number
  behind: number
  /** Unix seconds of the last commit. */
  time: number
}

export interface GitCommit {
  hash: string
  subject: string
  /** Unix seconds. */
  time: number
  author: string
}

/**
 * HEAD is the last commit, index what's staged, worktree what's on disk.
 * During a merge, base is the common ancestor, ours the current branch and
 * theirs the branch being merged in.
 */
export type GitRevision = "HEAD" | "index" | "worktree" | "base" | "ours" | "theirs"

export function fetchGitStatus(): Promise<GitStatus> {
  return getJson("/api/git/status", "Reading git status")
}

export async function fetchGitLog(limit = 30): Promise<GitCommit[]> {
  const { commits } = await getJson<{ commits: GitCommit[] }>(
    `/api/git/log?limit=${limit}`,
    "Reading history",
  )
  return commits
}

/** A file's content at a revision; null when it doesn't exist there. */
export async function fetchGitFile(path: string, rev: GitRevision): Promise<string | null> {
  const { content } = await getJson<{ content: string | null }>(
    `/api/git/show?path=${encodeURIComponent(path)}&rev=${rev}`,
    `Reading ${path}`,
  )
  return content
}

async function postGit<T>(url: string, body: unknown, what: string): Promise<T> {
  const res = await request(
    url,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    what,
  )
  if (!res.ok) throw await errorFromResponse(res, what)
  return res.json() as Promise<T>
}

export function stageFiles(paths: string[]): Promise<GitStatus> {
  return postGit("/api/git/stage", { paths }, "Staging")
}

export function unstageFiles(paths: string[]): Promise<GitStatus> {
  return postGit("/api/git/unstage", { paths }, "Unstaging")
}

export async function fetchGitBranches(): Promise<GitBranch[]> {
  const { branches } = await getJson<{ branches: GitBranch[] }>(
    "/api/git/branches",
    "Reading branches",
  )
  return branches
}

/** Switches to `branch`, or creates `create` (from `from`) and switches to it. */
export function switchBranch(
  opts: { branch: string } | { create: string; from?: string },
): Promise<GitStatus> {
  return postGit("/api/git/switch", opts, "Switching branch")
}

export function fetchRemotes(): Promise<GitStatus> {
  return postGit("/api/git/fetch", {}, "Fetching")
}

export function pullBranch(): Promise<GitStatus> {
  return postGit("/api/git/pull", {}, "Pulling")
}

export function pushBranch(opts: { force?: boolean } = {}): Promise<GitStatus> {
  return postGit("/api/git/push", opts, "Pushing")
}

export function mergeBranch(branch: string): Promise<GitStatus> {
  return postGit("/api/git/merge", { branch }, `Merging ${branch}`)
}

export function abortMerge(): Promise<GitStatus> {
  return postGit("/api/git/merge-abort", {}, "Aborting the merge")
}

/** Marks a conflict resolved, as written or by taking one side. */
export function resolveConflict(
  path: string,
  how: { content: string } | { take: "ours" | "theirs" },
): Promise<GitStatus> {
  return postGit("/api/git/resolve", { path, ...how }, `Resolving ${path}`)
}

/** Throws away unstaged changes; new files are deleted. */
export function discardChanges(paths: string[]): Promise<GitStatus> {
  return postGit("/api/git/discard", { paths }, "Discarding changes")
}

/** Replaces a file's staged content (for staging or unstaging one change). */
export function setStagedContent(path: string, content: string): Promise<GitStatus> {
  return postGit("/api/git/set-index", { path, content }, `Staging ${path}`)
}

export function undoLastCommit(): Promise<GitStatus> {
  return postGit("/api/git/undo-commit", {}, "Undoing the last commit")
}

export async function fetchStashes(): Promise<GitStash[]> {
  const { stashes } = await getJson<{ stashes: GitStash[] }>("/api/git/stashes", "Reading stashes")
  return stashes
}

export function stashChanges(opts: { message?: string; untracked?: boolean }): Promise<GitStatus> {
  return postGit("/api/git/stash", opts, "Stashing")
}

export function stashAction(index: number, action: "apply" | "pop" | "drop"): Promise<GitStatus> {
  const verb = action === "drop" ? "Dropping" : action === "pop" ? "Popping" : "Applying"
  return postGit("/api/git/stash-action", { index, action }, `${verb} the stash`)
}

export async function commitStaged(
  message: string,
  opts: { amend?: boolean; all?: boolean } = {},
): Promise<GitCommit> {
  const { commit } = await postGit<{ commit: GitCommit }>(
    "/api/git/commit",
    { message, ...opts },
    "Committing",
  )
  return commit
}
