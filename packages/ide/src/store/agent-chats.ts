import { create } from "zustand"
import { restBase } from "@/lib/api"

// Mirror the broker's public types. We don't import from
// "@darrylondil/lorien-runtime/agent-broker" because that pulls in node-only
// modules (ws, child_process). The shapes are intentionally identical to the
// broker's public protocol — see plan §4.2.

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
  hydrate(): Promise<void>
}

let pickerCounter = 0

export const useAgentChats = create<AgentChatsState>((set, get) => ({
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
        turnInFlight: event.kind === "turn_done" ? false : tab.turnInFlight,
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
      // network failure during hydrate is non-fatal — user sees an empty list,
      // can retry by opening the panel again or refreshing
    }
  },
}))
