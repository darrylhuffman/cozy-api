import { useDockviewApi } from "@/store/dockview-api"
import { useTabsStore } from "@/store/tabs"

/**
 * Open a code file in the editor, or refocus the existing tab if already
 * open. Uses the file path as the stable tab id so multiple callers (files
 * panel, View-source context-menu action) always land on the same tab.
 */
export function openCodeFile(path: string): void {
  const title = path.split("/").pop() ?? path
  useTabsStore.getState().openTab({
    id: path,
    title,
    kind: "node",
    path,
  })
  const api = useDockviewApi.getState().api
  api?.getPanel("editor")?.api.setActive()
}
