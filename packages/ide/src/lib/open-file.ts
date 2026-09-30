import { useDockviewApi } from "@/store/dockview-api"
import { useTabsStore } from "@/store/tabs"
import { openCodeFile } from "./open-code-file"

/**
 * Opens a workspace file in the editor: a workflow on its canvas, anything
 * else as code. Reuses the tab already showing the file, whatever opened it.
 */
export function openWorkspaceFile(path: string): void {
  const store = useTabsStore.getState()
  const existing = store.tabs.find((t) => t.kind !== "diff" && t.path === path)
  if (existing) {
    store.selectTab(existing.id)
    useDockviewApi.getState().api?.getPanel("editor")?.api.setActive()
    return
  }
  if (!path.endsWith(".workflow")) {
    openCodeFile(path)
    return
  }
  store.openTab({ id: path, title: path.split("/").pop() ?? path, kind: "workflow", path })
  useDockviewApi.getState().api?.getPanel("editor")?.api.setActive()
}
