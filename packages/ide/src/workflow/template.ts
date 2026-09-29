/**
 * Substitute templated placeholders in a schema-default value.
 * Supported tokens:
 *   {workflow_path} — the workflow file's folder path, e.g. "/users"
 *                     for a workflow at "workflows/users/create.workflow"
 */
export function expandTemplate(value: unknown, ctx: { workflowPath: string }): unknown {
  if (typeof value !== "string") return value
  return value.replace(/\{workflow_path\}/g, () => deriveWorkflowPath(ctx.workflowPath))
}

/**
 * Compute the route path for a workflow file path.
 *
 * Rules:
 *  - Strip the "workflows/" prefix and ".workflow" suffix.
 *  - If the last segment is a common CRUD verb (create/update/delete/list/…)
 *    AND there is at least one parent segment, drop it.
 *  - Prepend "/" and join remaining segments.
 *
 * Examples:
 *   "workflows/users/create.workflow"       → "/users"
 *   "workflows/posts/list.workflow"         → "/posts"
 *   "workflows/health.workflow"             → "/health"
 *   "workflows/admin/users/delete.workflow" → "/admin/users"
 */
export function deriveWorkflowPath(workflowFilePath: string): string {
  const stripped = workflowFilePath
    .replace(/^workflows\//, "")
    .replace(/\.workflow$/, "")
  const parts = stripped.split("/").filter(Boolean)
  if (parts.length === 0) return "/"
  const verbs = new Set(["create", "update", "delete", "list", "get", "show", "index"])
  if (parts.length > 1 && verbs.has(parts[parts.length - 1]!.toLowerCase())) {
    parts.pop()
  }
  return "/" + parts.join("/")
}
