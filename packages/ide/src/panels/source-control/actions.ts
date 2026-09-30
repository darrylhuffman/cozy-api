import type { GitFileChange } from "@/lib/api"
import { confirmAction } from "@/store/confirm"
import { useGitStore } from "@/store/git"

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * Discards unstaged changes after asking, as VS Code does: tracked files go
 * back to their staged or committed content, new files are deleted.
 */
export async function discardFiles(files: GitFileChange[]): Promise<void> {
  if (files.length === 0) return
  const created = files.filter((f) => f.status === "U")
  const name = (f: GitFileChange) => f.path.split("/").pop() ?? f.path
  const only = files.length === 1 ? files[0] : undefined
  const title = only
    ? only.status === "U"
      ? `Delete ${name(only)}?`
      : `Discard changes to ${name(only)}?`
    : `Discard ${plural(files.length, "change")}?`
  const description =
    created.length === 0
      ? "Your unstaged edits are lost. This can't be undone."
      : created.length === files.length
        ? `${created.length === 1 ? "This file isn't" : "These files aren't"} tracked by git yet, so ${created.length === 1 ? "it" : "they"} can't be recovered.`
        : `${plural(created.length, "new file")} ${created.length === 1 ? "is" : "are"} deleted, and edits to the rest are lost. This can't be undone.`
  const ok = await confirmAction({
    title,
    description,
    confirmLabel: only?.status === "U" ? "Delete file" : "Discard",
    destructive: true,
  })
  if (ok) await useGitStore.getState().discard(files.map((f) => f.path))
}

/** Whether the last commit is already on the remote, so rewriting it needs a force push. */
function headIsPushed(): boolean {
  const s = useGitStore.getState().status
  return !!s?.repo && s.upstream !== null && s.ahead === 0 && s.head !== null
}

export async function undoLastCommit(): Promise<void> {
  const s = useGitStore.getState().status
  if (!s?.repo || !s.head) return
  if (headIsPushed()) {
    const ok = await confirmAction({
      title: `Undo "${s.head.subject}"?`,
      description: `This commit is already on ${s.upstream}. Undoing it here doesn't remove it there, and your next push will need a force push. Its changes stay staged.`,
      confirmLabel: "Undo commit",
      destructive: true,
    })
    if (!ok) return
  }
  await useGitStore.getState().undoCommit()
}

/** Amends the last commit with what's staged; an empty message keeps the old one. */
export async function amendLastCommit(message: string): Promise<boolean> {
  const s = useGitStore.getState().status
  if (!s?.repo || !s.head) return false
  if (headIsPushed()) {
    const ok = await confirmAction({
      title: `Amend "${s.head.subject}"?`,
      description: `This commit is already on ${s.upstream}. Amending rewrites it, so your next push will need a force push.`,
      confirmLabel: "Amend",
      destructive: true,
    })
    if (!ok) return false
  }
  return useGitStore.getState().commit(message, { amend: true })
}

export async function forcePush(): Promise<void> {
  const s = useGitStore.getState().status
  if (!s?.repo || !s.branch) return
  const ok = await confirmAction({
    title: `Force push ${s.branch}?`,
    description: `This replaces ${s.upstream ?? "the remote branch"} with your local branch. It refuses if someone else pushed since you last fetched.`,
    confirmLabel: "Force push",
    destructive: true,
  })
  if (ok) await useGitStore.getState().push({ force: true })
}
