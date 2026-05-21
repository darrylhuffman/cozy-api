import { useEffect, useRef } from "react"
import { useAgentChats } from "@/store/agent-chats"
import { InputBar } from "./input-bar"

interface ChatViewProps {
  chatId: string
}

export function ChatView({ chatId }: ChatViewProps): React.ReactElement | null {
  const tab = useAgentChats((s) => s.chats[chatId])
  const sendMessage = useAgentChats((s) => s.sendMessage)
  const scrollRef = useRef<HTMLDivElement>(null)
  const eventCount = tab?.kind === "chat" ? tab.events.length : 0

  useEffect(() => {
    // Auto-scroll on new events. Guard required: jsdom does not implement scrollTo.
    const el = scrollRef.current
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    }
  }, [eventCount])

  if (!tab || tab.kind !== "chat") return null

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center border-b bg-muted/20 px-3 text-xs">
        <span className="font-medium">{tab.title}</span>
        <span className="ml-2 text-muted-foreground">· {tab.agent}</span>
      </div>
      {tab.error && (
        <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {tab.error}
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {tab.events.map((event, i) => (
          <div
            key={i}
            data-testid="agent-event-row"
            className="mb-2 text-xs text-foreground"
          >
            <span className="font-mono text-muted-foreground">[{event.kind}]</span>{" "}
            {/* Real cards land in Task 8. */}
            {event.kind === "assistant_text" || event.kind === "user_message"
              ? event.text
              : null}
          </div>
        ))}
      </div>
      <InputBar
        disabled={tab.turnInFlight}
        onSend={(text) => sendMessage(chatId, text)}
      />
    </div>
  )
}
