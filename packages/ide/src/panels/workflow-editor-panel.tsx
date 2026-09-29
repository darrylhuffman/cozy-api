import { EditorTabStrip } from "@/components/editor-tab-strip"
import { confirmAction } from "@/store/confirm"
import { useTabsStore, useWorkflowTabs } from "@/store/tabs"
import { useWorkflowDrafts } from "@/store/workflow-drafts"
import { WorkflowEditor } from "@/workflow/workflow-editor"

export function WorkflowEditorPanel() {
  const tabs = useWorkflowTabs()
  const activeId = useTabsStore((s) => s.activeWorkflowId)
  const selectTab = useTabsStore((s) => s.selectTab)
  const closeTab = useTabsStore((s) => s.closeTab)

  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground">
        <p className="text-sm">Open a .workflow file to see its graph here.</p>
      </div>
    )
  }

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]

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
    useWorkflowDrafts.getState().drop(tabId)
  }

  return (
    <div className="flex h-full flex-col">
      <EditorTabStrip
        tabs={tabs.map((t) => ({ id: t.id, title: t.title, hint: t.path, dirty: t.dirty }))}
        activeId={active?.id ?? null}
        onSelect={selectTab}
        onClose={(id) => void handleClose(id)}
      />

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {active?.path ? (
          // Keyed per tab: each tab gets fresh canvas state (expansion,
          // viewport) while its edits persist in the drafts store.
          <WorkflowEditor key={active.id} path={active.path} tabId={active.id} />
        ) : active ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
            <h2 className="text-xl font-semibold">{active.title}</h2>
            <p className="text-sm text-muted-foreground">
              This tab has no file path. Re-open it from the file tree.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
