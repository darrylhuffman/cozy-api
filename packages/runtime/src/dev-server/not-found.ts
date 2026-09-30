import type { Hono } from "hono"

/**
 * Unmatched requests answer JSON like every other error: 405 with an `Allow`
 * header when the path exists under another method, otherwise 404. Codegen
 * emits the same handler into a built server's dist/index.ts.
 */
export function answerUnmatchedWithJson(app: Hono): void {
  app.notFound((c) => {
    const allowed = allowedMethods(app.routes, c.req.path)
    if (allowed.length > 0)
      return c.json({ error: "Method Not Allowed" }, 405, { Allow: allowed.join(", ") })
    return c.json({ error: "Not Found" }, 404)
  })
}

/** The methods whose routes match `path` (`:param` segments match any one segment). */
export function allowedMethods(
  routes: Array<{ method: string; path: string }>,
  path: string,
): string[] {
  const out = new Set<string>()
  for (const r of routes) {
    if (r.method !== "ALL" && routePattern(r.path).test(path)) out.add(r.method)
  }
  return [...out]
}

function routePattern(route: string): RegExp {
  const segments = route.split("/").map((seg) => {
    if (seg.startsWith(":")) return "[^/]+"
    if (seg === "*") return ".*"
    return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  })
  return new RegExp(`^${segments.join("/")}/?$`)
}
