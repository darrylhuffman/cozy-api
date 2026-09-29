import { CodeEditor } from "@/code/code-editor"
import { EditorTabStrip } from "@/components/editor-tab-strip"
import { useCodeDrafts } from "@/store/code-drafts"
import { confirmAction } from "@/store/confirm"
import { useCodeTabs, useTabsStore } from "@/store/tabs"

export function CodeEditorPanel() {
  const tabs = useCodeTabs()
  const activeId = useTabsStore((s) => s.activeCodeId)
  const selectTab = useTabsStore((s) => s.selectTab)
  const closeTab = useTabsStore((s) => s.closeTab)

  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground">
        <p className="text-sm">Open a .ts node file to edit it here.</p>
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
    useCodeDrafts.getState().drop(tabId)
  }

  return (
    <div className="flex h-full flex-col">
      <EditorTabStrip
        tabs={tabs.map((t) => ({ id: t.id, title: t.title, hint: t.path, dirty: t.dirty }))}
        activeId={active?.id ?? null}
        onSelect={selectTab}
        onClose={(id) => void handleClose(id)}
      />
      <div className="flex-1 overflow-hidden">
        {active?.path ? (
          <CodeEditor key={active.id} path={active.path} tabId={active.id} />
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
