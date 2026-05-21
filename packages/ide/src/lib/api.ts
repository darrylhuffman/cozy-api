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
  in?: Record<string, unknown>
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
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string }
    throw new Error(err.error ?? `Save failed: ${res.status}`)
  }
  return res.json() as Promise<SaveResult>
}
