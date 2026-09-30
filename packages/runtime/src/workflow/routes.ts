import type { WorkflowFile } from "./types.js"

/** One HTTP route a workflow serves: an `@core/http-request` node's method and path. */
export interface WorkflowRoute {
  nodeId: string
  method: string
  path: string
}

const CRUD_VERBS = new Set(["create", "update", "delete", "list", "get", "show", "index"])

/**
 * The path an `@core/http-request` node serves when it doesn't set one: the
 * workflow's folder under workflows/, dropping a trailing CRUD verb.
 * "workflows/users/create.workflow" → "/users", "workflows/health.workflow" →
 * "/health". The IDE shows the same default.
 */
export function defaultRoutePath(relativePath: string): string {
  const stripped = relativePath.replace(/^workflows\//, "").replace(/\.workflow$/, "")
  const parts = stripped.split("/").filter(Boolean)
  if (parts.length === 0) return "/"
  if (parts.length > 1 && CRUD_VERBS.has(parts[parts.length - 1]!.toLowerCase())) parts.pop()
  return `/${parts.join("/")}`
}

/** The routes a workflow file serves, one per `@core/http-request` node. */
export function workflowRoutes(file: WorkflowFile, relativePath: string): WorkflowRoute[] {
  const routes: WorkflowRoute[] = []
  for (const [nodeId, inst] of Object.entries(file.nodes)) {
    if (inst.uses !== "@core/http-request") continue
    const values = (inst.values ?? {}) as Record<string, unknown>
    const path = typeof values.path === "string" && values.path ? values.path : undefined
    const method = typeof values.method === "string" && values.method ? values.method : "GET"
    routes.push({
      nodeId,
      method: method.toUpperCase(),
      path: path ?? defaultRoutePath(relativePath),
    })
  }
  return routes
}

/** A method and path served by more than one workflow (or trigger). */
export interface RouteConflict {
  method: string
  path: string
  /** "workflows/rooms/list.workflow#Request", in the order they were found. */
  sources: string[]
}

/**
 * Routes that more than one trigger serves. Hono would silently answer with
 * whichever was registered first, so these are errors. Path params are
 * compared by position (`/rooms/:id` and `/rooms/:roomId` conflict).
 */
export function findRouteConflicts(
  workflows: Array<{ relativePath: string; file: WorkflowFile }>,
): RouteConflict[] {
  const seen = new Map<string, RouteConflict>()
  for (const wf of workflows) {
    for (const r of workflowRoutes(wf.file, wf.relativePath)) {
      const shape = r.path.replace(/:[^/]+/g, ":")
      const key = `${r.method} ${shape}`
      const entry = seen.get(key) ?? { method: r.method, path: r.path, sources: [] }
      entry.sources.push(`${wf.relativePath}#${r.nodeId}`)
      seen.set(key, entry)
    }
  }
  return [...seen.values()].filter((c) => c.sources.length > 1)
}
