import { Plus } from "lucide-react"
import { EditorTabStrip } from "@/components/editor-tab-strip"
import { useAgentChats } from "@/store/agent-chats"

/**
 * Chat tabs. Same strip as the editor, so many chats scroll with arrows
 * instead of a scrollbar, with a + button at the end for a new chat.
 */
export function SubTabStrip(): React.ReactElement {
  const order = useAgentChats((s) => s.order)
  const chats = useAgentChats((s) => s.chats)
  const activeChatId = useAgentChats((s) => s.activeChatId)
  const setActive = useAgentChats((s) => s.setActive)
  const closeTab = useAgentChats((s) => s.closeTab)
  const newChat = useAgentChats((s) => s.newChat)

  const tabs = order.map((id) => {
    const tab = chats[id]
    return { id, title: tab?.kind === "chat" ? tab.title : "New chat" }
  })

  return (
    <EditorTabStrip
      tabs={tabs}
      activeId={activeChatId}
      onSelect={setActive}
      onClose={closeTab}
      closeLabel={() => "Close chat"}
      trailing={
        <button
          type="button"
          aria-label="New chat"
          title="New chat"
          className="flex w-8 shrink-0 items-center justify-center border-l border-border text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => newChat()}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      }
    />
  )
}
