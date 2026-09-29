import { afterEach, describe, expect, it, vi } from "vitest"
import { useAgentChats } from "@/store/agent-chats"
import { useDockviewApi } from "@/store/dockview-api"
import { askAi } from "./ask"
import { CONTEXT_MARKER } from "./prompts"

const original = useAgentChats.getState().startChatWith

afterEach(() => {
  useAgentChats.setState({ startChatWith: original })
  useDockviewApi.setState({ api: null } as never)
})

describe("askAi", () => {
  it("focuses the Agents panel and starts a chat with the rendered prompt", () => {
    const startChatWith = vi.fn(() => "chat-1")
    useAgentChats.setState({ startChatWith })
    const setActive = vi.fn()
    useDockviewApi.setState({ api: { getPanel: () => ({ api: { setActive } }) } } as never)
    askAi({ title: "Explain save", headline: "Explain it", context: ["ctx"] })
    expect(setActive).toHaveBeenCalled()
    expect(startChatWith).toHaveBeenCalledWith({
      title: "Explain save",
      prompt: `Explain it${CONTEXT_MARKER}ctx`,
    })
  })

  it("still starts the chat when no dock layout is mounted", () => {
    const startChatWith = vi.fn(() => "chat-1")
    useAgentChats.setState({ startChatWith })
    askAi({ title: "t", headline: "h", context: [] })
    expect(startChatWith).toHaveBeenCalledWith({ title: "t", prompt: "h" })
  })
})
