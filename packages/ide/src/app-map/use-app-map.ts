import { useEffect, useMemo, useState } from "react"
import type { FileNode } from "@/data/mock-files"
import { fetchWorkflowFile, fetchWorkspaceTree, type WorkflowFile } from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"
import { useProvidersStore, useWorkspaceProviders } from "@/store/providers"
import { useSchemas } from "@/store/schemas"
import { type AppMap, buildAppMap } from "./model"

/** Wait this long after the last workflow change before re-reading them. */
const WORKFLOWS_REFRESH_DEBOUNCE_MS = 300

function workflowPaths(node: FileNode, out: string[] = []): string[] {
  if (node.type === "folder") for (const c of node.children) workflowPaths(c, out)
  else if (node.kind === "workflow" && node.path) out.push(node.path)
  return out
}

/** Every workflow file in the workspace, parsed, kept fresh while mounted. */
function useWorkflowFiles(): {
  workflows: { path: string; file: WorkflowFile | null }[]
  loaded: boolean
} {
  const [state, setState] = useState<{
    workflows: { path: string; file: WorkflowFile | null }[]
    loaded: boolean
  }>({
    workflows: [],
    loaded: false,
  })
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = async () => {
      try {
        const tree = await fetchWorkspaceTree()
        const paths = workflowPaths(tree.workflows)
        const workflows = await Promise.all(
          paths.map((path) =>
            fetchWorkflowFile(path)
              .then((file) => ({ path, file }))
              .catch(() => ({ path, file: null })),
          ),
        )
        if (alive) setState({ workflows, loaded: true })
      } catch {
        if (alive) setState((s) => ({ ...s, loaded: true }))
      }
    }
    void load()
    const unsubscribe = subscribeToFileEvents((e) => {
      if (e.type !== "ready" && !e.path.endsWith(".workflow")) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load(), WORKFLOWS_REFRESH_DEBOUNCE_MS)
    })
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [])
  return state
}

/** The Application map for the open workspace, rebuilt when any of its sources change. */
export function useAppMap(): { map: AppMap; loaded: boolean } {
  useWorkspaceProviders()
  const schemas = useSchemas()
  const providers = useProvidersStore((s) => s.providers)
  const middleware = useProvidersStore((s) => s.middleware)
  const nodeProviders = useProvidersStore((s) => s.nodes)
  const { workflows, loaded } = useWorkflowFiles()
  const map = useMemo(
    () => buildAppMap({ workflows, schemas, providers, middleware, nodeProviders }),
    [workflows, schemas, providers, middleware, nodeProviders],
  )
  return { map, loaded }
}
