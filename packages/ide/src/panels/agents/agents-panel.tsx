import { useEffect } from "react"
import { useAgentChats } from "@/store/agent-chats"
import { AgentPicker } from "./agent-picker"
import { ChatView } from "./chat-view"
import { EmptyState } from "./empty-state"
import { SubTabStrip } from "./sub-tab-strip"

export function AgentsPanel(): React.ReactElement {
  const order = useAgentChats((s) => s.order)
  const activeChatId = useAgentChats((s) => s.activeChatId)
  const chats = useAgentChats((s) => s.chats)
  const newChat = useAgentChats((s) => s.newChat)
  const hydrate = useAgentChats((s) => s.hydrate)
  const connect = useAgentChats((s) => s.connect)
  const disconnect = useAgentChats((s) => s.disconnect)

  useEffect(() => {
    void hydrate()
    connect()
    return () => {
      disconnect()
    }
  }, [hydrate, connect, disconnect])

  if (order.length === 0) {
    return <EmptyState onStart={() => newChat()} />
  }

  const active = activeChatId ? chats[activeChatId] : undefined

  return (
    <div className="flex h-full flex-col">
      <SubTabStrip />
      <div className="flex-1 overflow-hidden">
        {active?.kind === "picker" && <AgentPicker pickerId={active.id} />}
        {active?.kind === "chat" && <ChatView chatId={active.id} />}
        {!active && (
          <div className="p-4 text-sm text-muted-foreground">No active chat.</div>
        )}
      </div>
    </div>
  )
}
