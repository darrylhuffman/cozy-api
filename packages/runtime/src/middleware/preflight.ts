import { workflowRoutes } from "../workflow/routes.js"
import type { WorkflowFile } from "../workflow/types.js"
import { middlewareChain } from "./load.js"

/**
 * An OPTIONS route to add so middleware can answer a CORS preflight. Without
 * it, OPTIONS on a path no workflow serves under that method gets 405 before
 * any `_middleware.ts` runs.
 */
export interface PreflightRoute {
  /** The path as the owning workflow writes it (`/events/:id`). */
  path: string
  /** The methods workflows serve on this path, for the 405 when middleware lets OPTIONS through. */
  methods: string[]
  /** The workflow whose built file registers the route (the first by path). */
  owner: string
  /**
   * The middleware folders every workflow on this path shares, outermost
   * first. Always a prefix of the owner's own chain.
   */
  dirs: string[]
}

/**
 * The paths that need a preflight route: served by at least one workflow,
 * not already served under OPTIONS, and guarded by middleware that every
 * workflow on the path shares (only that middleware runs on the preflight).
 */
export function preflightRoutes(
  workflows: Array<{ relativePath: string; file: WorkflowFile }>,
  middlewareDirs: string[],
): PreflightRoute[] {
  const files = middlewareDirs.map((dir) => ({ dir }))
  const byShape = new Map<string, Array<{ path: string; method: string; workflow: string }>>()
  for (const wf of workflows) {
    for (const r of workflowRoutes(wf.file, wf.relativePath)) {
      const shape = r.path.replace(/:[^/]+/g, ":")
      const list = byShape.get(shape) ?? []
      list.push({ path: r.path, method: r.method, workflow: wf.relativePath })
      byShape.set(shape, list)
    }
  }
  const out: PreflightRoute[] = []
  for (const routes of byShape.values()) {
    if (routes.some((r) => r.method === "OPTIONS")) continue
    const owners = [...new Set(routes.map((r) => r.workflow))].sort()
    const chains = owners.map((wf) => middlewareChain(wf, files).map((f) => f.dir))
    const dirs = chains[0]!.filter((dir) => chains.every((c) => c.includes(dir)))
    if (dirs.length === 0) continue
    const owner = owners[0]!
    out.push({
      path: routes.find((r) => r.workflow === owner)!.path,
      methods: [...new Set(routes.map((r) => r.method))].sort(),
      owner,
      dirs,
    })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}
