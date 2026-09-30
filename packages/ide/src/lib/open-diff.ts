import type { GitRevision } from "@/lib/api"
import { useDockviewApi } from "@/store/dockview-api"
import { useTabsStore } from "@/store/tabs"

/** Opens (or refocuses) a tab comparing two revisions of a file. */
export function openDiff(path: string, base: GitRevision, head: GitRevision): void {
  const name = path.split("/").pop() ?? path
  useTabsStore.getState().openTab({
    id: `diff:${base}:${head}:${path}`,
    title: `${name} · diff`,
    kind: "diff",
    path,
    diff: { base, head },
  })
  useDockviewApi.getState().api?.getPanel("editor")?.api.setActive()
}

/** Opens (or refocuses) the tab for resolving a merge conflict in a file. */
export function openConflict(path: string): void {
  const name = path.split("/").pop() ?? path
  useTabsStore.getState().openTab({
    id: `conflict:${path}`,
    title: `${name} · conflict`,
    kind: "diff",
    path,
    diff: { base: "ours", head: "theirs" },
  })
  useDockviewApi.getState().api?.getPanel("editor")?.api.setActive()
}
