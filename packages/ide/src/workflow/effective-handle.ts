/**
 * Edge routing helper: given a logical handle path (e.g. "user.email") and the
 * current set of EXPANDED parent paths for a node, return the deepest handle
 * id that is actually rendered in the DOM.
 *
 * The rendering rule is: a handle at path P is rendered iff its PARENT path
 * is in the expanded set. The root (P === "") is always rendered.
 *
 * Walking from the leaf upward: the deepest candidate whose PARENT is
 * expanded is the visible handle. If nothing along the chain has its parent
 * expanded, we fall back to the root.
 *
 * Examples (root path = ""):
 *   effectiveHandle("user.email", {"", "user"})  → "user.email"  (parent "user" expanded)
 *   effectiveHandle("user.email", {""})          → "user"        (parent "" of "user" is root, always expanded)
 *   effectiveHandle("user.email", {})            → ""            (root only)
 *   effectiveHandle("user", {""})                → "user"
 *   effectiveHandle("user", {})                  → ""
 *   effectiveHandle("", anything)                → ""            (root is always itself)
 *
 * The empty string is treated as the ROOT path. The empty string in
 * `expandedSet` means "the root branch is expanded" (its direct children
 * are rendered).
 */
export function effectiveHandle(handle: string, expandedSet: ReadonlySet<string>): string {
  // The root is always rendered as itself.
  if (handle === "") return ""

  const segments = handle.split(".")

  // Walk from the leaf upward. For each candidate path, its parent must be
  // expanded for the candidate to be rendered. The parent of a top-level
  // segment is the root ("").
  for (let i = segments.length; i > 0; i--) {
    const candidate = segments.slice(0, i).join(".")
    const parent = i === 1 ? "" : segments.slice(0, i - 1).join(".")
    if (expandedSet.has(parent)) return candidate
  }
  // Nothing along the chain has its parent expanded → fall back to the root.
  return ""
}
