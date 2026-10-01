import { deleteWorkspaceItem, fetchItemUsage, renameWorkspaceItem } from "@/lib/api"
import { useCodeDrafts } from "@/store/code-drafts"
import { confirmAction } from "@/store/confirm"
import { type OpenTab, useTabsStore } from "@/store/tabs"
import { useWorkflowDrafts } from "@/store/workflow-drafts"

/** A workflow or node file the explorer can rename or delete. */
export interface WorkspaceItem {
  /** Workspace-relative path, e.g. "workflows/pets/add.workflow". */
  path: string
  kind: "workflow" | "node" | "subworkflow"
}

/** "add-pet.ts" → { stem: "add-pet", ext: ".ts" } */
export function splitName(path: string): { stem: string; ext: string } {
  const name = path.split("/").pop() ?? path
  const ext = name.endsWith(".workflow") ? ".workflow" : ".ts"
  return { stem: name.slice(0, -ext.length), ext }
}

/** Why `stem` can't be used as a new file name, or null if it's fine. */
export function invalidName(stem: string): string | null {
  if (!stem) return "Enter a name"
  if (!/^[A-Za-z0-9][\w.-]*$/.test(stem)) {
    return "Use letters, numbers, dashes, dots and underscores"
  }
  if (/\.(cases|requests|test|spec|d)$/.test(stem)) return "That suffix is reserved"
  return null
}

function tabFor(path: string): OpenTab | undefined {
  return useTabsStore.getState().tabs.find((t) => t.path === path)
}

function dropTab(tab: OpenTab) {
  useTabsStore.getState().closeTab(tab.id)
  if (tab.kind === "workflow") useWorkflowDrafts.getState().drop(tab.id)
  else useCodeDrafts.getState().drop(tab.id)
}

/** The tree's tab id for a file, following the tab it replaces (see buildFileTree). */
function renamedTabId(tab: OpenTab, from: string, to: string): string {
  if (tab.id === from) return to
  const encode = (p: string) => p.replace(/[/\\]/g, "-").replace(/\./g, "_")
  const oldSuffix = encode(from)
  return tab.id.endsWith(oldSuffix)
    ? `${tab.id.slice(0, -oldSuffix.length)}${encode(to)}`
    : `${tab.id}-renamed`
}

/**
 * Renames an item to `stem` in the same folder. An open tab follows the file;
 * a tab with unsaved changes blocks the rename rather than losing them.
 * Returns the new path. Throws with a message for the dialog to show.
 */
export async function renameItem(item: WorkspaceItem, stem: string): Promise<string> {
  const problem = invalidName(stem)
  if (problem) throw new Error(problem)
  const { ext } = splitName(item.path)
  const folder = item.path.split("/").slice(0, -1).join("/")
  const to = `${folder}/${stem}${ext}`
  if (to === item.path) return to

  const tab = tabFor(item.path)
  if (tab?.dirty) throw new Error(`Save or discard your changes to ${tab.title} first`)

  await renameWorkspaceItem(item.path, to)

  if (tab) {
    const store = useTabsStore.getState()
    const index = store.tabs.findIndex((t) => t.id === tab.id)
    const wasActive = store.activeId === tab.id
    dropTab(tab)
    const next: OpenTab = {
      id: renamedTabId(tab, item.path, to),
      title: `${stem}${ext}`,
      kind: tab.kind,
      path: to,
    }
    store.openTab(next)
    useTabsStore.getState().moveTab(next.id, index)
    if (!wasActive && store.activeId) useTabsStore.getState().selectTab(store.activeId)
  }
  return to
}

/**
 * Deletes an item after asking. The question names the companion file that
 * goes with it and, for a node, the workflows that still use it.
 */
export async function deleteItem(item: WorkspaceItem): Promise<boolean> {
  const name = item.path.split("/").pop() ?? item.path
  const { stem } = splitName(item.path)
  const lines: string[] = [
    item.kind === "workflow"
      ? `Its saved requests (${stem}.requests.json) are deleted too, if it has any.`
      : `Its test cases (${stem}.cases.json) are deleted too, if it has any.`,
  ]
  if (item.kind !== "workflow") {
    const { usedBy } = await fetchItemUsage(item.path).catch(() => ({ usedBy: [] as string[] }))
    if (usedBy.length > 0) {
      const names = usedBy.map((p) => p.replace(/^workflows\//, ""))
      lines.push(`Still used by ${names.join(", ")}, which will show a missing node.`)
    }
  }
  const tab = tabFor(item.path)
  if (tab?.dirty) lines.push("Your unsaved changes to it are lost.")

  const ok = await confirmAction({
    title: `Delete ${name}?`,
    description: lines.join(" "),
    confirmLabel: "Delete",
    destructive: true,
  })
  if (!ok) return false
  await deleteWorkspaceItem(item.path)
  if (tab) dropTab(tab)
  return true
}
