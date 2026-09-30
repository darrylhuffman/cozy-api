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
