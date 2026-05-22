import type { PortNode } from "./schema-to-tree"

/**
 * Edge routing helper: given a logical handle path (e.g. "user.email") and
 * the set of handle paths that are CURRENTLY RENDERED for a node, return the
 * deepest rendered ancestor of the logical path. That ancestor is where the
 * edge should anchor in the DOM.
 *
 * The "visible paths" model decouples rendering from the user's expansion
 * state — a path is in the set iff a `<Handle>` with that id is mounted right
 * now. This handles a subtlety the older expansion-based logic missed: when a
 * logical path refers into a port that doesn't itself decompose into children
 * (e.g. `body.email` against an opaque `body` leaf), the walk must stop at
 * the deepest path that ACTUALLY EXISTS as a handle. Falling back to "" only
 * works when the side actually renders a root handle (inputs do; outputs
 * don't), so doing that unconditionally produced ghost edges.
 *
 * Use the `computeVisibleInputPaths` / `computeVisibleOutputPaths` helpers
 * below to build the set from the port tree + expansion state.
 *
 * Examples (with a hypothetical visible set):
 *   effectiveHandle("user.email", {"", "user", "user.email"})  → "user.email"
 *   effectiveHandle("user.email", {"", "user"})                → "user"
 *   effectiveHandle("user.email", {""})                        → ""
 *   effectiveHandle("body.email", {"body"})                    → "body"  (no root on outputs side)
 *   effectiveHandle("", anything)                              → ""
 */
export function effectiveHandle(
  handle: string,
  visiblePaths: ReadonlySet<string>,
): string {
  if (handle === "") return ""
  if (visiblePaths.has(handle)) return handle
  const segments = handle.split(".")
  for (let i = segments.length - 1; i >= 1; i--) {
    const candidate = segments.slice(0, i).join(".")
    if (visiblePaths.has(candidate)) return candidate
  }
  return ""
}

/**
 * Returns the set of currently-rendered input handle paths for a node.
 *
 * The synthetic input root ("") is always rendered. A child is rendered iff
 * its parent's path is in `expanded`. Recurses to grandchildren under the
 * same rule.
 */
export function computeVisibleInputPaths(
  root: PortNode,
  expanded: ReadonlySet<string>,
): Set<string> {
  const visible = new Set<string>()
  visible.add("")
  const walk = (port: PortNode): void => {
    if (!expanded.has(port.id)) return
    for (const child of port.children) {
      visible.add(child.id)
      walk(child)
    }
  }
  walk(root)
  return visible
}

/**
 * Returns the set of currently-rendered output handle paths for a node.
 *
 * Output trees have no synthetic root — every top-level port is always
 * rendered. A child of a branch is rendered iff that branch's path is in
 * `expanded`.
 */
export function computeVisibleOutputPaths(
  outputs: readonly PortNode[],
  expanded: ReadonlySet<string>,
): Set<string> {
  const visible = new Set<string>()
  const walk = (port: PortNode): void => {
    visible.add(port.id)
    if (!expanded.has(port.id)) return
    for (const child of port.children) walk(child)
  }
  for (const top of outputs) walk(top)
  return visible
}
