import { useEffect } from "react"
import { useAgentChats } from "@/store/agent-chats"
import { AgentPicker } from "./agent-picker"
import { EmptyState } from "./empty-state"
import { SubTabStrip } from "./sub-tab-strip"

export function AgentsPanel(): React.ReactElement {
  const order = useAgentChats((s) => s.order)
  const activeChatId = useAgentChats((s) => s.activeChatId)
  const chats = useAgentChats((s) => s.chats)
  const newChat = useAgentChats((s) => s.newChat)
  const hydrate = useAgentChats((s) => s.hydrate)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  if (order.length === 0) {
    return <EmptyState onStart={() => newChat()} />
  }

  const active = activeChatId ? chats[activeChatId] : undefined

  return (
    <div className="flex h-full flex-col">
      <SubTabStrip />
      <div className="flex-1 overflow-hidden">
        {active?.kind === "picker" && <AgentPicker pickerId={active.id} />}
        {active?.kind === "chat" && (
          <div className="p-4 text-sm text-muted-foreground">
            Chat view — Task 7 will replace this. Chat id: {active.id}
          </div>
        )}
        {!active && (
          <div className="p-4 text-sm text-muted-foreground">No active chat.</div>
        )}
      </div>
    </div>
  )
}
