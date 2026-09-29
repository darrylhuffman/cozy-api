import type { WorkflowFile } from "@/lib/api"

/**
 * Returns a new workflow with a new node appended. Generates a unique id
 * from the last segment of `uses` and assigns it the given position in `view`.
 */
export function addNode(
  wf: WorkflowFile,
  uses: string,
  position: { x: number; y: number },
): WorkflowFile {
  const id = uniqueId(nodeIdFromUses(uses), new Set(Object.keys(wf.nodes)))
  return {
    ...wf,
    nodes: { ...wf.nodes, [id]: { uses } },
    view: { ...(wf.view ?? {}), [id]: position },
  }
}

/**
 * Returns the last meaningful segment of a `uses` string, suitable as both
 * the seed for unique-id generation AND the display label on a node card.
 *
 * Examples:
 *   "@core/http-request"           → "http-request"
 *   "./nodes/users/save-user"      → "save-user"
 *   "./nodes/users/save-user.ts"   → "save-user"
 */
export function idFromUses(uses: string): string {
  const stripped = uses.startsWith("@core/") ? uses.slice("@core/".length) : uses
  const last = stripped.split("/").filter(Boolean).pop() ?? "node"
  return last.replace(/\.[tj]sx?$/, "").replace(/[^a-zA-Z0-9-]/g, "-")
}

/**
 * The instance id for a freshly added node: `idFromUses` camel-cased into a
 * JavaScript identifier, because ids are the first segment of references
 * ("saveUser.user") and the reference grammar has no room for hyphens.
 *
 *   "@core/http-request"      → "httpRequest"
 *   "./nodes/users/save-user" → "saveUser"
 */
export function nodeIdFromUses(uses: string): string {
  const words = idFromUses(uses).split("-").filter(Boolean)
  const camel = words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("")
  if (camel.length === 0) return "node"
  return /^[0-9]/.test(camel) ? `n${camel}` : camel
}

/** First free id among base, base2, base3, … */
export function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let i = 2; i < 10000; i++) {
    const candidate = `${base}${i}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error("failed to allocate unique node id")
}
