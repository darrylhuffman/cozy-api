import { describe, expect, it, beforeEach, vi } from "vitest"
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
