import { fetchGitFile, type GitFileChange, type GitRevision, parseWorkflowContent } from "@/lib/api"
import { diffWorkflows, type WorkflowDiff } from "@/workflow/workflow-diff"

async function workflowAt(path: string, rev: GitRevision) {
  const text = await fetchGitFile(path, rev)
  if (text === null) return null
  try {
    return parseWorkflowContent(path, text)
  } catch {
    return null
  }
}

/** A workflow's graph changes between two revisions. */
export async function workflowDiffFor(
  path: string,
  base: GitRevision,
  head: GitRevision,
): Promise<WorkflowDiff> {
  const [before, after] = await Promise.all([workflowAt(path, base), workflowAt(path, head)])
  return diffWorkflows(before, after)
}

/** "1 node added, 1 changed, 1 removed", or "layout only", or "". */
export function summarize(diff: WorkflowDiff): string {
  const count = (state: string) => Object.values(diff.nodes).filter((s) => s === state).length
  const parts = (
    [
      [count("added"), "added"],
      [count("changed"), "changed"],
      [count("removed"), "removed"],
    ] as const
  ).filter(([n]) => n > 0)
  if (parts.length === 0) return diff.moved.length > 0 ? "layout only" : ""
  return parts
    .map(([n, label], i) =>
      i === 0 ? `${n} ${n === 1 ? "node" : "nodes"} ${label}` : `${n} ${label}`,
    )
    .join(", ")
}

const VERB: Record<GitFileChange["status"], string> = {
  A: "Add",
  U: "Add",
  D: "Remove",
  M: "Update",
  R: "Rename",
}

/** "add SendWelcome, change SaveUser, remove LegacyAudit" for a workflow's diff. */
function describeNodes(diff: WorkflowDiff): string {
  const by = (state: string) => Object.keys(diff.nodes).filter((id) => diff.nodes[id] === state)
  const parts: string[] = []
  const added = by("added")
  const changed = by("changed")
  const removed = by("removed")
  if (added.length) parts.push(`add ${added.join(", ")}`)
  if (changed.length) parts.push(`change ${changed.join(", ")}`)
  if (removed.length) parts.push(`remove ${removed.join(", ")}`)
  return parts.join("; ")
}

/**
 * A commit message drafted from what's staged: a subject line, and for several
 * files one line per file. Workflows say which nodes changed.
 */
export async function suggestCommitMessage(staged: GitFileChange[]): Promise<string> {
  const lines = await Promise.all(
    staged.map(async (f) => {
      const name = f.path.split("/").pop() ?? f.path
      if (f.path.endsWith(".workflow") && f.status !== "D") {
        const nodes = describeNodes(await workflowDiffFor(f.path, "HEAD", "index"))
        if (nodes) return `${VERB[f.status]} ${name}: ${nodes}`
      }
      return `${VERB[f.status]} ${name}`
    }),
  )
  if (lines.length === 1) return lines[0] ?? ""
  const verbs = new Set(staged.map((f) => VERB[f.status]))
  const subject =
    verbs.size === 1 ? `${[...verbs][0]} ${staged.length} files` : `Update ${staged.length} files`
  return `${subject}\n\n${lines.map((l) => `- ${l}`).join("\n")}`
}
