import { X } from "lucide-react"
import { cn } from "@/lib/utils"
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

  return (
    <div className="flex h-full flex-col">
      {/* Custom tab strip for code tabs */}
      <div className="flex shrink-0 items-center gap-px overflow-x-auto border-b border-border bg-muted/30">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "group flex shrink-0 items-center gap-2 border-r border-border bg-muted px-3 py-1.5 text-sm",
              tab.id === activeId && "bg-background",
            )}
          >
            <button
              type="button"
              onClick={() => selectTab(tab.id)}
              className={cn(
                "min-w-0 truncate",
                tab.id === activeId
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.title}
            </button>
            <button
              type="button"
              onClick={() => closeTab(tab.id)}
              className="rounded-sm p-0.5 text-muted-foreground opacity-60 hover:bg-accent hover:opacity-100"
              aria-label={`Close ${tab.title}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto p-6">
        {active && (
          <div className="space-y-3">
            <h2 className="text-xl font-semibold">{active.title}</h2>
            <p className="text-sm text-muted-foreground">
              Monaco-based code editor lands in sub-project #5.
            </p>
            <div className="rounded-md border border-border bg-muted/30 p-4 font-mono text-xs text-muted-foreground">
              path: {active.path ?? "(unknown)"}
              {"\n"}id: {active.id}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
