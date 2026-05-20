import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTabsStore } from "@/store/tabs"

export function EditorPanel() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeId = useTabsStore((s) => s.activeId)
  const selectTab = useTabsStore((s) => s.selectTab)
  const closeTab = useTabsStore((s) => s.closeTab)

  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground">
        <p>Open a file from the Files panel to begin.</p>
      </div>
    )
  }

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-px overflow-x-auto border-b bg-muted/30">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "group flex shrink-0 items-center gap-2 border-r bg-background/50 px-3 py-1.5 text-sm",
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

      <div className="flex-1 overflow-auto p-6">
        {active && <ActiveTabPlaceholder tab={active} />}
      </div>
    </div>
  )
}

function ActiveTabPlaceholder({
  tab,
}: {
  tab: { id: string; title: string; kind: "workflow" | "node" }
}) {
  const message =
    tab.kind === "workflow"
      ? "Visual workflow editor lands in sub-project #4."
      : "Monaco-based code editor lands in sub-project #5."
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">{tab.title}</h2>
      <p className="text-sm text-muted-foreground">{message}</p>
      <div className="rounded-md border bg-muted/30 p-4 font-mono text-xs text-muted-foreground">
        kind: {tab.kind}
        {"\n"}id: {tab.id}
      </div>
    </div>
  )
}
