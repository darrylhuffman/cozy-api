import { CodeEditor } from "@/code/code-editor"
import { EditorTabStrip, type StripTab } from "@/components/editor-tab-strip"
import { useCodeDrafts } from "@/store/code-drafts"
import { confirmAction } from "@/store/confirm"
import { type OpenTab, useTabsStore } from "@/store/tabs"
import { useWorkflowDrafts } from "@/store/workflow-drafts"
import { WorkflowEditor } from "@/workflow/workflow-editor"

/** Folder name to tell apart tabs whose file names collide. */
function stripTabs(tabs: OpenTab[]): StripTab[] {
  const counts = new Map<string, number>()
  for (const t of tabs) counts.set(t.title, (counts.get(t.title) ?? 0) + 1)
  return tabs.map((t) => {
    const parts = t.path?.split("/") ?? []
    const folder = parts.length > 1 ? parts[parts.length - 2] : undefined
    return {
      id: t.id,
      title: t.title,
      hint: t.path,
      kind: t.kind === "workflow" ? "workflow" : "node",
      dirty: t.dirty,
      detail: (counts.get(t.title) ?? 0) > 1 ? folder : undefined,
    }
  })
}

/**
 * The editor area: workflows and code files share one tab strip. A workflow
 * tab shows the graph editor, anything else the code editor.
 */
export function EditorPanel() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeId = useTabsStore((s) => s.activeId)
  const activeWorkflowId = useTabsStore((s) => s.activeWorkflowId)
  const selectTab = useTabsStore((s) => s.selectTab)
  const closeTab = useTabsStore((s) => s.closeTab)

  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6 text-muted-foreground">
        <p className="text-sm">Open a workflow or node file from the Explorer.</p>
      </div>
    )
  }

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]
  const workflowTab =
    active?.kind === "workflow"
      ? active
      : tabs.find((t) => t.id === activeWorkflowId && t.kind === "workflow")
  const showingWorkflow = active?.kind === "workflow"

  async function handleClose(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId)
    if (tab?.dirty) {
      const confirmed = await confirmAction({
        title: `Close ${tab.title} without saving?`,
        description: "Your unsaved changes will be lost.",
        confirmLabel: "Close without saving",
        destructive: true,
      })
      if (!confirmed) return
    }
    closeTab(tabId)
    if (tab?.kind === "workflow") useWorkflowDrafts.getState().drop(tabId)
    else useCodeDrafts.getState().drop(tabId)
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <EditorTabStrip
        tabs={stripTabs(tabs)}
        activeId={active?.id ?? null}
        onSelect={selectTab}
        onClose={(id) => void handleClose(id)}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* The last workflow stays mounted under a code tab, so the Inspector,
            Tests and Run panels keep their context and the canvas keeps its
            viewport. Keyed per tab: each workflow gets fresh canvas state
            while its edits persist in the drafts store. */}
        {workflowTab?.path && (
          <div className={showingWorkflow ? "h-full" : "hidden"}>
            <WorkflowEditor
              key={workflowTab.id}
              path={workflowTab.path}
              tabId={workflowTab.id}
              visible={showingWorkflow}
            />
          </div>
        )}
        {active && !active.path && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
            <h2 className="text-xl font-semibold">{active.title}</h2>
            <p className="text-sm text-muted-foreground">
              This tab has no file path. Re-open it from the Explorer.
            </p>
          </div>
        )}
        {active?.path && active.kind !== "workflow" && (
          <CodeEditor key={active.id} path={active.path} tabId={active.id} />
        )}
      </div>
    </div>
  )
}
