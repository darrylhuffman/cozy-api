import { Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAgentChats } from "@/store/agent-chats"

export function SubTabStrip(): React.ReactElement {
  const order = useAgentChats((s) => s.order)
  const chats = useAgentChats((s) => s.chats)
  const activeChatId = useAgentChats((s) => s.activeChatId)
  const setActive = useAgentChats((s) => s.setActive)
  const closeTab = useAgentChats((s) => s.closeTab)
  const newChat = useAgentChats((s) => s.newChat)

  return (
    <div className="flex h-8 shrink-0 items-center gap-px overflow-x-auto border-b bg-muted/30 px-1">
      {order.map((id) => {
        const tab = chats[id]
        const label = tab?.kind === "chat" ? tab.title : "New chat"
        const active = id === activeChatId
        return (
          <div
            key={id}
            className={cn(
              "group flex h-6 shrink-0 items-center gap-1 rounded-sm border border-transparent px-2 text-xs cursor-pointer",
              active
                ? "border-border bg-background text-foreground"
                : "text-muted-foreground hover:bg-accent/40",
            )}
            onClick={() => setActive(id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setActive(id)
            }}
            role="tab"
            tabIndex={0}
            aria-selected={active}
          >
            <span className="max-w-[120px] truncate">{label}</span>
            <button
              type="button"
              aria-label="Close chat"
              className="opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(id)
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        aria-label="New chat"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent/40"
        onClick={() => newChat()}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
