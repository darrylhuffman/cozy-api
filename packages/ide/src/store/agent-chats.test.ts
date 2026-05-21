import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { useAgentChats } from "./agent-chats.js"

function reset(): void {
  // Reset store to initial state between tests
  useAgentChats.setState(useAgentChats.getInitialState())
}

describe("useAgentChats", () => {
  beforeEach(reset)

  it("initial state has no chats, no active chat, picker is closed", () => {
    const s = useAgentChats.getState()
    expect(s.chats).toEqual({})
    expect(s.order).toEqual([])
    expect(s.activeChatId).toBeNull()
    expect(s.availability).toBeNull()
  })

  it("newChat() opens a picker tab with a synthetic id", () => {
    const id = useAgentChats.getState().newChat()
    expect(id).toMatch(/^picker-/)
    const s = useAgentChats.getState()
    expect(s.order).toContain(id)
    expect(s.chats[id]?.kind).toBe("picker")
    expect(s.activeChatId).toBe(id)
  })

  it("setActive() switches the active sub-tab", () => {
    const a = useAgentChats.getState().newChat()
    const b = useAgentChats.getState().newChat()
    expect(useAgentChats.getState().activeChatId).toBe(b)
    useAgentChats.getState().setActive(a)
    expect(useAgentChats.getState().activeChatId).toBe(a)
  })

  it("closeTab() removes a chat and falls back to the previous one", () => {
    const a = useAgentChats.getState().newChat()
    const b = useAgentChats.getState().newChat()
    useAgentChats.getState().closeTab(b)
    const s = useAgentChats.getState()
    expect(s.order).toEqual([a])
    expect(s.activeChatId).toBe(a)
  })

  it("closeTab() clears activeChatId when the last tab closes", () => {
    const a = useAgentChats.getState().newChat()
    useAgentChats.getState().closeTab(a)
    expect(useAgentChats.getState().activeChatId).toBeNull()
  })

  it("setAvailability() stores the probed response", () => {
    useAgentChats.getState().setAvailability({
      claude: { installed: true, version: "1.0.0" },
      codex: { installed: false },
    })
    const av = useAgentChats.getState().availability
    expect(av?.claude.installed).toBe(true)
    expect(av?.codex.installed).toBe(false)
  })

  it("setChatCreated() upgrades a picker tab to a real chat", () => {
    const pickerId = useAgentChats.getState().newChat()
    useAgentChats.getState().setChatCreated(pickerId, "real-chat-1", "claude")
    const s = useAgentChats.getState()
    expect(s.chats[pickerId]).toBeUndefined()
    expect(s.chats["real-chat-1"]?.kind).toBe("chat")
    expect(s.activeChatId).toBe("real-chat-1")
    expect(s.order).toEqual(["real-chat-1"])
  })

  it("appendEvent() adds to the chat's event list", () => {
    useAgentChats.getState().setChatCreated("picker-1", "c1", "claude")
    useAgentChats.getState().appendEvent("c1", {
      kind: "assistant_text",
      text: "hi",
      turnId: "t",
      at: "2026-05-21T00:00:00Z",
    })
    const chat = useAgentChats.getState().chats["c1"]
    if (chat?.kind === "chat") {
      expect(chat.events).toHaveLength(1)
      expect(chat.events[0]!.kind).toBe("assistant_text")
    } else {
      throw new Error("expected chat kind")
    }
  })

  it("hydrate() loads chat list via fetch", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/__lorien/agents/chats")) {
        return new Response(
          JSON.stringify({
            version: 1,
            chats: [
              {
                id: "c1",
                agent: "claude",
                title: "First",
                createdAt: "2026-05-21T00:00:00Z",
                lastEventAt: "2026-05-21T00:00:00Z",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        )
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    await useAgentChats.getState().hydrate()
    const s = useAgentChats.getState()
    expect(s.order).toEqual(["c1"])
    expect(s.chats["c1"]?.kind).toBe("chat")
    vi.unstubAllGlobals()
  })
})

describe("useAgentChats WebSocket integration", () => {
  let constructed: MockWebSocket[]

  class MockWebSocket {
    static OPEN = 1
    static CLOSED = 3
    // Mirror real WebSocket: constants are accessible on instances too.
    readonly OPEN = MockWebSocket.OPEN
    readonly CLOSED = MockWebSocket.CLOSED
    readyState = MockWebSocket.OPEN
    listeners: Record<string, ((e: unknown) => void)[]> = {}
    sent: string[] = []

    constructor(public url: string) {
      constructed.push(this)
      // Fire open synchronously in microtask
      queueMicrotask(() => this.fire("open", {}))
    }
    addEventListener(type: string, cb: (e: unknown) => void): void {
      ;(this.listeners[type] ??= []).push(cb)
    }
    removeEventListener(type: string, cb: (e: unknown) => void): void {
      this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== cb)
    }
    send(data: string): void {
      this.sent.push(data)
    }
    close(): void {
      this.readyState = MockWebSocket.CLOSED
      this.fire("close", {})
    }
    fire(type: string, ev: unknown): void {
      for (const cb of this.listeners[type] ?? []) cb(ev)
    }
    pushMessage(payload: object): void {
      this.fire("message", { data: JSON.stringify(payload) })
    }
  }

  beforeEach(() => {
    reset()
    constructed = []
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useAgentChats.getState().disconnect()
  })

  it("connect() opens a WebSocket once", async () => {
    useAgentChats.getState().connect()
    expect(constructed).toHaveLength(1)
    expect(constructed[0]!.url).toBe("ws://localhost:3000/__lorien/agents/ws")
    useAgentChats.getState().connect()
    // Idempotent — no new socket
    expect(constructed).toHaveLength(1)
  })

  it("startClaudeChat sends a new_chat message", async () => {
    useAgentChats.getState().connect()
    await Promise.resolve() // let microtask fire 'open'
    const pickerId = useAgentChats.getState().newChat()
    useAgentChats.getState().startClaudeChat(pickerId)
    const sent = constructed[0]!.sent
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]!)).toEqual({ type: "new_chat", agent: "claude" })
  })

  it("chat_created server message upgrades the picker tab", async () => {
    useAgentChats.getState().connect()
    await Promise.resolve()
    const pickerId = useAgentChats.getState().newChat()
    useAgentChats.getState().startClaudeChat(pickerId)
    constructed[0]!.pushMessage({ type: "chat_created", chatId: "c-new" })
    const s = useAgentChats.getState()
    expect(s.chats["c-new"]?.kind).toBe("chat")
    expect(s.activeChatId).toBe("c-new")
  })

  it("event messages append to the chat", async () => {
    useAgentChats.getState().connect()
    await Promise.resolve()
    const pickerId = useAgentChats.getState().newChat()
    useAgentChats.getState().startClaudeChat(pickerId)
    constructed[0]!.pushMessage({ type: "chat_created", chatId: "c-evt" })
    constructed[0]!.pushMessage({
      type: "event",
      chatId: "c-evt",
      event: {
        kind: "assistant_text",
        text: "hi",
        turnId: "t1",
        at: "2026-05-21T00:00:00Z",
      },
    })
    const tab = useAgentChats.getState().chats["c-evt"]
    if (tab?.kind === "chat") {
      expect(tab.events).toHaveLength(1)
    } else {
      throw new Error("expected chat")
    }
  })

  it("agent_error sets the chat's error and clears turnInFlight", async () => {
    useAgentChats.getState().connect()
    await Promise.resolve()
    const pickerId = useAgentChats.getState().newChat()
    useAgentChats.getState().startClaudeChat(pickerId)
    constructed[0]!.pushMessage({ type: "chat_created", chatId: "c-err" })
    useAgentChats.getState().setTurnInFlight("c-err", true)
    constructed[0]!.pushMessage({
      type: "agent_error",
      chatId: "c-err",
      message: "Claude not signed in",
      recoverable: true,
    })
    const tab = useAgentChats.getState().chats["c-err"]
    if (tab?.kind === "chat") {
      expect(tab.error).toMatch(/not signed in/i)
      expect(tab.turnInFlight).toBe(false)
    }
  })

  it("sendMessage queues until WS open and then writes", async () => {
    useAgentChats.getState().connect()
    await Promise.resolve()
    const pickerId = useAgentChats.getState().newChat()
    useAgentChats.getState().startClaudeChat(pickerId)
    constructed[0]!.pushMessage({ type: "chat_created", chatId: "c-snd" })
    useAgentChats.getState().sendMessage("c-snd", "hi")
    const sentTypes = constructed[0]!.sent.map((s) => JSON.parse(s).type)
    expect(sentTypes).toEqual(["new_chat", "user"])
    // optimistic local user_message event:
    const tab = useAgentChats.getState().chats["c-snd"]
    if (tab?.kind === "chat") {
      expect(tab.events[0]?.kind).toBe("user_message")
      expect(tab.turnInFlight).toBe(true)
    }
  })
})
