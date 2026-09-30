import { useEffect, useRef } from "react"
import type { AgentEvent } from "@/store/agent-chats"
import { useAgentChats } from "@/store/agent-chats"
import {
  AssistantError,
  AssistantText,
  ToolUseBash,
  ToolUseEdit,
  ToolUseRead,
  UserMessage,
} from "./cards"
import { InputBar } from "./input-bar"

function eventKey(event: AgentEvent, fallback: number): string {
  if (event.kind === "tool_use" || event.kind === "tool_result") {
    return `${event.kind}-${event.toolUseId}`
  }
  if (event.kind === "assistant_text" || event.kind === "turn_done") {
    return `${event.kind}-${event.turnId}-${fallback}`
  }
  return `${event.kind}-${event.at}-${fallback}`
}

function EventRow({ event }: { event: AgentEvent }): React.ReactElement | null {
  switch (event.kind) {
    case "user_message":
      return <UserMessage text={event.text} />
    case "assistant_text":
      return <AssistantText text={event.text} />
    case "tool_use": {
      const input = (event.input ?? {}) as Record<string, unknown>
      const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined)
      // Claude Code names the file `file_path`; older/mock events use `path`.
      const path = str("file_path") ?? str("path") ?? ""
      const command = str("command") ?? ""
      if (event.tool === "Read" || event.tool === "Grep") {
        return <ToolUseRead path={path || str("pattern") || event.tool} />
      }
      if (event.tool === "Edit") {
        return <ToolUseEdit path={path} before={str("old_string")} after={str("new_string")} />
      }
      if (event.tool === "Write") {
        return <ToolUseEdit path={path} after={str("content")} />
      }
      if (event.tool === "Bash") {
        return <ToolUseBash command={command} />
      }
      return <div className="text-xs text-muted-foreground">tool: {event.tool}</div>
    }
    case "tool_result":
      // Result events arrive after the tool_use card already exists. v1 doesn't
      // render a separate row for results — the tool_use card stays as the
      // visible artifact. Future versions could fold the summary back into it.
      return null
    case "turn_done":
      return null
    default:
      return null
  }
}

interface ChatViewProps {
  chatId: string
}

export function ChatView({ chatId }: ChatViewProps): React.ReactElement | null {
  const tab = useAgentChats((s) => s.chats[chatId])
  const sendMessage = useAgentChats((s) => s.sendMessage)
  const cancelTurn = useAgentChats((s) => s.cancelTurn)
  const scrollRef = useRef<HTMLDivElement>(null)
  const eventCount = tab?.kind === "chat" ? tab.events.length : 0

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a new event arrives
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
      <div className="flex h-8 shrink-0 items-center border-b border-border bg-card px-3 text-xs">
        <span className="font-medium">{tab.title}</span>
        <span className="ml-2 text-muted-foreground">· {tab.agent}</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {tab.events.map((event, i) => (
          <div key={eventKey(event, i)} data-testid="agent-event-row" className="mb-2">
            <EventRow event={event} />
          </div>
        ))}
        {tab.turnInFlight && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ai" />
            Working…
          </div>
        )}
        {tab.error && <AssistantError message={tab.error} />}
      </div>
      <InputBar
        disabled={tab.turnInFlight}
        onSend={(text) => sendMessage(chatId, text)}
        onStop={() => cancelTurn(chatId)}
      />
    </div>
  )
}
