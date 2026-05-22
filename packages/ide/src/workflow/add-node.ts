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
  const baseId = idFromUses(uses)
  const id = uniqueId(baseId, new Set(Object.keys(wf.nodes)))
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

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let i = 2; i < 10000; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error("failed to allocate unique node id")
}
