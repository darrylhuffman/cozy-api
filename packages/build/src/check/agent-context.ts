import { introspectProviders } from "../commands/introspect-providers.js"

/** Where each kind of code goes in a lorien project, for agents. */
export const WHERE_THINGS_GO = [
  "- An HTTP route: a workflow in workflows/ (a .workflow file).",
  "- Business logic: a node in nodes/ (defineNode). Nodes never open connections or read process.env.",
  "- A database, cache, queue, logger or API client: a provider in providers/ (defineProvider with a selector, a lifetime and an env schema). Nodes read it from run()'s second argument by its selector.",
  "- Auth, CORS, rate limits, request logging: workflows/<folder>/_middleware.ts (defineMiddleware); it runs before every route in that folder and below.",
  "- Shared zod schemas and helpers: lib/.",
  "- Never a new top-level folder.",
].join("\n")

/**
 * What the IDE's agents are told about the project before their first
 * message: where things go, and the providers and middleware that already
 * exist, so they reuse `db` instead of opening a second connection.
 */
export async function agentProjectContext(root: string): Promise<string> {
  const { providers, middleware } = await introspectProviders(root, {})
  const lines = ["<lorien-project>", "This is a lorien project. Where things go:", WHERE_THINGS_GO]
  lines.push("")
  if (providers.length === 0) {
    lines.push("Providers: none yet.")
  } else {
    lines.push("Providers already in this project (reuse these; don't open another connection):")
    for (const p of providers) {
      const about = p.description ? `: ${p.description}` : ""
      lines.push(`- ${p.name} (${p.lifetime}, ${p.path})${about}`)
    }
  }
  if (middleware.length > 0) {
    lines.push("Middleware:")
    for (const m of middleware) {
      const names = m.names.filter((n): n is string => n !== null)
      lines.push(`- ${m.path}${names.length > 0 ? ` (${names.join(", ")})` : ""}`)
    }
  }
  lines.push("")
  lines.push(
    "After changing providers, nodes or middleware, run `npx lorien check`: each finding says where the code should live.",
  )
  lines.push("</lorien-project>")
  return lines.join("\n")
}
