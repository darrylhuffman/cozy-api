import { create } from "zustand"
import { restBase, wsUrl } from "@/lib/api"

export type AgentName = "claude" | "codex"

export type ToolKind = "Read" | "Edit" | "Write" | "Bash" | "Grep" | "Other"

export type AgentEvent =
  | { kind: "user_message"; text: string; at: string }
  | { kind: "assistant_text"; text: string; turnId: string; at: string }
  | {
      kind: "tool_use"
      toolUseId: string
      tool: ToolKind
      input: unknown
      status: "started" | "completed" | "denied" | "pending_approval"
      at: string
    }
  | { kind: "tool_result"; toolUseId: string; ok: boolean; summary?: string; at: string }
  | {
      kind: "turn_done"
      turnId: string
      usage?: { inputTokens: number; outputTokens: number }
      at: string
    }

export interface AgentAvailability {
  installed: boolean
  version?: string
  authed?: boolean
}

/**
 * Mirrors the broker's `Record<AgentName, AgentAvailability>` shape so
 * consumers can index by an `AgentName` variable without a cast.
 */
export type AvailabilityResponse = Record<AgentName, AgentAvailability>

interface PickerTab {
  kind: "picker"
  id: string
}

interface ChatTab {
  kind: "chat"
  id: string
  agent: AgentName
  title: string
  events: AgentEvent[]
  turnInFlight: boolean
  error: string | null
}

type Tab = PickerTab | ChatTab

type ServerMsg =
  | { type: "chat_created"; chatId: string }
  | { type: "event"; chatId: string; event: AgentEvent }
  | { type: "agent_error"; chatId: string; message: string; recoverable: boolean }
  | { type: "chat_closed"; chatId: string; reason: "subprocess_exit" | "user_cancel" }

interface AgentChatsState {
  chats: Record<string, Tab>
  order: string[]
  activeChatId: string | null
  availability: AvailabilityResponse | null

  newChat(): string
  setActive(id: string | null): void
  closeTab(id: string): void
  setAvailability(av: AvailabilityResponse): void
  setChatCreated(pickerId: string, realId: string, agent: AgentName): void
  appendEvent(chatId: string, event: AgentEvent): void
  setError(chatId: string, error: string | null): void
  setTurnInFlight(chatId: string, inFlight: boolean): void

  // WS layer
  connect(): void
  disconnect(): void
  startClaudeChat(pickerId: string): void
  sendMessage(chatId: string, text: string): void
  cancelTurn(chatId: string): void

  // REST
  hydrate(): Promise<void>
}

let pickerCounter = 0

// WS state is held outside the store to avoid serializing it via setState.
interface WsContext {
  socket: WebSocket | null
  pickerWaitingForId: string | null
  reconnectDelay: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  closed: boolean
}

const ws: WsContext = {
  socket: null,
  pickerWaitingForId: null,
  reconnectDelay: 1000,
  reconnectTimer: null,
  closed: false,
}

export const useAgentChats = create<AgentChatsState>((set, get) => {
  function onMessage(raw: string): void {
    let msg: ServerMsg
    try {
      msg = JSON.parse(raw) as ServerMsg
    } catch {
      return
    }
    if (msg.type === "chat_created") {
      const pickerId = ws.pickerWaitingForId
      ws.pickerWaitingForId = null
      if (pickerId) {
        get().setChatCreated(pickerId, msg.chatId, "claude")
      }
      return
    }
    if (msg.type === "event") {
      get().appendEvent(msg.chatId, msg.event)
      return
    }
    if (msg.type === "agent_error") {
      get().setError(msg.chatId, msg.message)
      get().setTurnInFlight(msg.chatId, false)
      return
    }
    if (msg.type === "chat_closed") {
      get().setTurnInFlight(msg.chatId, false)
      return
    }
  }

  function attachSocket(s: WebSocket): void {
    s.addEventListener("message", (e: unknown) => {
      const data = (e as { data: string }).data
      onMessage(data)
    })
    s.addEventListener("close", () => {
      ws.socket = null
      if (ws.closed) return
      // Backoff reconnect
      ws.reconnectTimer = setTimeout(() => {
        ws.reconnectDelay = Math.min(ws.reconnectDelay * 2, 30_000)
        get().connect()
      }, ws.reconnectDelay)
    })
    s.addEventListener("open", () => {
      ws.reconnectDelay = 1000
      // Re-subscribe to active chat (no replay in v1 — re-fetch via REST).
      const active = get().activeChatId
      const tab = active ? get().chats[active] : undefined
      if (tab && tab.kind === "chat") {
        try {
          s.send(JSON.stringify({ type: "open_chat", chatId: tab.id }))
        } catch {
          /* ignore — connection just opened */
        }
        // Re-fetch transcript to recover any missed events
        void fetchTranscript(tab.id)
      }
    })
  }

  async function fetchTranscript(chatId: string): Promise<void> {
    try {
      const res = await fetch(`${restBase()}/__lorien/agents/chats/${chatId}`)
      if (!res.ok) return
      const t = (await res.json()) as {
        id: string
        agent: AgentName
        title: string
        events: AgentEvent[]
      }
      set((s) => {
        const tab = s.chats[chatId]
        if (!tab || tab.kind !== "chat") return s
        return {
          chats: {
            ...s.chats,
            [chatId]: { ...tab, events: t.events, title: t.title },
          },
        }
      })
    } catch {
      /* swallow */
    }
  }

  function safeSend(payload: object): void {
    if (ws.socket && ws.socket.readyState === ws.socket.OPEN) {
      ws.socket.send(JSON.stringify(payload))
    }
    // If the socket isn't open, we drop. Reconnect will not replay user
    // messages — UX hardens in a follow-up. For v1, the button shouldn't
    // be clickable when WS is disconnected (ChatView checks turnInFlight).
  }

  return {
    chats: {},
    order: [],
    activeChatId: null,
    availability: null,

    newChat() {
      pickerCounter += 1
      const id = `picker-${Date.now()}-${pickerCounter}`
      set((s) => ({
        chats: { ...s.chats, [id]: { kind: "picker", id } satisfies PickerTab },
        order: [...s.order, id],
        activeChatId: id,
      }))
      return id
    },

    setActive(id) {
      set({ activeChatId: id })
    },

    closeTab(id) {
      set((s) => {
        const { [id]: _drop, ...rest } = s.chats
        const order = s.order.filter((x) => x !== id)
        let active = s.activeChatId
        if (active === id) {
          const idx = s.order.indexOf(id)
          active = order[Math.max(0, idx - 1)] ?? order[0] ?? null
        }
        return { chats: rest, order, activeChatId: active }
      })
    },

    setAvailability(av) {
      set({ availability: av })
    },

    setChatCreated(pickerId, realId, agent) {
      set((s) => {
        const { [pickerId]: _drop, ...rest } = s.chats
        const chatTab: ChatTab = {
          kind: "chat",
          id: realId,
          agent,
          title: "untitled",
          events: [],
          turnInFlight: false,
          error: null,
        }
        const order = s.order.map((x) => (x === pickerId ? realId : x))
        return {
          chats: { ...rest, [realId]: chatTab },
          order,
          activeChatId: s.activeChatId === pickerId ? realId : s.activeChatId,
        }
      })
    },

    appendEvent(chatId, event) {
      set((s) => {
        const tab = s.chats[chatId]
        if (!tab || tab.kind !== "chat") return s
        let title = tab.title
        if (title === "untitled" && event.kind === "user_message") {
          title = event.text.slice(0, 60)
        }
        const updated: ChatTab = {
          ...tab,
          events: [...tab.events, event],
          title,
          turnInFlight:
            event.kind === "turn_done" ? false : tab.turnInFlight,
        }
        return { chats: { ...s.chats, [chatId]: updated } }
      })
    },

    setError(chatId, error) {
      set((s) => {
        const tab = s.chats[chatId]
        if (!tab || tab.kind !== "chat") return s
        return { chats: { ...s.chats, [chatId]: { ...tab, error } } }
      })
    },

    setTurnInFlight(chatId, inFlight) {
      set((s) => {
        const tab = s.chats[chatId]
        if (!tab || tab.kind !== "chat") return s
        return { chats: { ...s.chats, [chatId]: { ...tab, turnInFlight: inFlight } } }
      })
    },

    connect() {
      if (ws.socket) return
      ws.closed = false
      const s = new WebSocket(wsUrl())
      ws.socket = s
      attachSocket(s)
    },

    disconnect() {
      ws.closed = true
      if (ws.reconnectTimer) {
        clearTimeout(ws.reconnectTimer)
        ws.reconnectTimer = null
      }
      ws.socket?.close()
      ws.socket = null
    },

    startClaudeChat(pickerId) {
      // The next `chat_created` message is routed to upgrade this picker.
      ws.pickerWaitingForId = pickerId
      safeSend({ type: "new_chat", agent: "claude" })
    },

    sendMessage(chatId, text) {
      // Optimistic local append so the user sees their message immediately.
      const ev: AgentEvent = {
        kind: "user_message",
        text,
        at: new Date().toISOString(),
      }
      get().appendEvent(chatId, ev)
      get().setTurnInFlight(chatId, true)
      safeSend({ type: "user", chatId, text })
    },

    cancelTurn(chatId) {
      safeSend({ type: "cancel", chatId })
      get().setTurnInFlight(chatId, false)
    },

    async hydrate() {
      try {
        const res = await fetch(`${restBase()}/__lorien/agents/chats`)
        if (!res.ok) return
        const idx = (await res.json()) as {
          version: 1
          chats: Array<{
            id: string
            agent: AgentName
            title: string
            createdAt: string
            lastEventAt: string
          }>
        }
        set((s) => {
          const next: Record<string, Tab> = { ...s.chats }
          const order: string[] = [...s.order]
          for (const c of idx.chats) {
            if (next[c.id]) continue
            next[c.id] = {
              kind: "chat",
              id: c.id,
              agent: c.agent,
              title: c.title,
              events: [],
              turnInFlight: false,
              error: null,
            }
            order.push(c.id)
          }
          return { chats: next, order }
        })
      } catch {
        /* network failure during hydrate is non-fatal */
      }
    },
  }
})
