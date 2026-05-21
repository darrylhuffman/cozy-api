import type { FileFolder } from "@/data/mock-files"

export interface WorkspaceInfo {
  root: string
  name: string
}

export interface WorkspaceTree {
  workflows: FileFolder
  nodes: FileFolder
}

export interface WorkspaceFile {
  path: string
  content: string
}

export async function fetchWorkspaceInfo(): Promise<WorkspaceInfo> {
  const res = await fetch("/api/workspace/info")
  if (!res.ok) throw new Error(`/api/workspace/info returned ${res.status}`)
  return res.json() as Promise<WorkspaceInfo>
}

export async function fetchWorkspaceTree(): Promise<WorkspaceTree> {
  const res = await fetch("/api/workspace/tree")
  if (!res.ok) throw new Error(`/api/workspace/tree returned ${res.status}`)
  return res.json() as Promise<WorkspaceTree>
}

export async function fetchFile(path: string): Promise<WorkspaceFile> {
  const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error(`/api/workspace/file returned ${res.status}`)
  return res.json() as Promise<WorkspaceFile>
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
   * Two shapes:
   *  - per-field object:   { fieldName: "ref-or-literal", ... }
   *  - single reference:   "ref"  (whole-object form — the resolved value
   *                                  is passed as the node's input)
   */
  in?: string | Record<string, unknown>
  config?: Record<string, unknown>
  after?: string[]
  label?: string
}

export async function fetchWorkflowFile(path: string): Promise<WorkflowFile> {
  const { content } = await fetchFile(path)
  return JSON.parse(content) as WorkflowFile
}

export interface SaveResult {
  path: string
  bytes: number
}

export async function saveFile(path: string, content: string): Promise<SaveResult> {
  const res = await fetch("/api/workspace/file", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, content }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
      error?: string
    }
    throw new Error(err.error ?? `Save failed: ${res.status}`)
  }
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
  [key: string]: unknown
}

export interface NodeSchemas {
  inputs: JsonSchema
  outputs: JsonSchema
  /** Optional accent color string (e.g. "indigo", "#a78bfa"). */
  color?: string | null
}

export async function fetchWorkspaceSchemas(): Promise<Record<string, NodeSchemas>> {
  const res = await fetch("/api/workspace/schemas")
  if (!res.ok) throw new Error(`/api/workspace/schemas returned ${res.status}`)
  const { schemas } = (await res.json()) as { schemas: Record<string, NodeSchemas> }
  return schemas
}

/**
 * Creates a new file at `path` with `content`. Throws if the file already
 * exists (backend returns 409) or if the request fails for any other reason.
 */
export async function createWorkspaceFile(path: string, content: string): Promise<void> {
  const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(path)}&create=true`, {
    method: "PUT",
    body: content,
  })
  if (res.status === 409) throw new Error("File already exists")
  if (!res.ok) throw new Error(`PUT failed: ${res.status}`)
}
