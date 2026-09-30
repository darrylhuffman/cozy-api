import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAgentChats } from "@/store/agent-chats"
import { ChatView } from "./chat-view"

function reset(): void {
  useAgentChats.setState(useAgentChats.getInitialState())
}

beforeEach(reset)
afterEach(cleanup)

describe("ChatView", () => {
  it("renders the chat title in the header", () => {
    useAgentChats.getState().newChat()
    const pickerId = useAgentChats.getState().order[0]!
    useAgentChats.getState().setChatCreated(pickerId, "c1", "claude")
    render(<ChatView chatId="c1" />)
    // title is "untitled" until a user_message arrives
    expect(screen.getByText(/untitled/i)).toBeInTheDocument()
  })

  it("renders one row per event", () => {
    useAgentChats.getState().newChat()
    const pickerId = useAgentChats.getState().order[0]!
    useAgentChats.getState().setChatCreated(pickerId, "c1", "claude")
    useAgentChats.getState().appendEvent("c1", {
      kind: "user_message",
      text: "hi there",
      at: "2026-05-21T00:00:00Z",
    })
    useAgentChats.getState().appendEvent("c1", {
      kind: "assistant_text",
      text: "hello",
      turnId: "t1",
      at: "2026-05-21T00:00:00Z",
    })
    render(<ChatView chatId="c1" />)
    expect(screen.getAllByTestId("agent-event-row")).toHaveLength(2)
  })

  it("input bar sends a message via the store", () => {
    useAgentChats.getState().newChat()
    const pickerId = useAgentChats.getState().order[0]!
    useAgentChats.getState().setChatCreated(pickerId, "c1", "claude")
    const sendSpy = vi.fn()
    useAgentChats.setState({ sendMessage: sendSpy } as unknown as Parameters<
      typeof useAgentChats.setState
    >[0])
    render(<ChatView chatId="c1" />)
    const textarea = screen.getByRole("textbox", { name: /message/i })
    fireEvent.change(textarea, { target: { value: "do the thing" } })
    fireEvent.click(screen.getByRole("button", { name: /send/i }))
    expect(sendSpy).toHaveBeenCalledWith("c1", "do the thing")
  })

  it("input bar is disabled while turn is in flight", () => {
    useAgentChats.getState().newChat()
    const pickerId = useAgentChats.getState().order[0]!
    useAgentChats.getState().setChatCreated(pickerId, "c1", "claude")
    useAgentChats.getState().setTurnInFlight("c1", true)
    render(<ChatView chatId="c1" />)
    const textarea = screen.getByRole("textbox", { name: /message/i })
    expect(textarea).toBeDisabled()
  })

  it("renders an error banner when the chat has an error", () => {
    useAgentChats.getState().newChat()
    const pickerId = useAgentChats.getState().order[0]!
    useAgentChats.getState().setChatCreated(pickerId, "c1", "claude")
    useAgentChats.getState().setError("c1", "Claude CLI not installed")
    render(<ChatView chatId="c1" />)
    expect(screen.getByRole("alert").textContent).toContain("Claude CLI not installed")
  })

  it("shows a Stop button while the agent works, which cancels the turn", () => {
    useAgentChats.getState().newChat()
    const pickerId = useAgentChats.getState().order[0]!
    useAgentChats.getState().setChatCreated(pickerId, "c1", "claude")
    useAgentChats.getState().setTurnInFlight("c1", true)
    const cancelSpy = vi.fn()
    useAgentChats.setState({ cancelTurn: cancelSpy } as unknown as Parameters<
      typeof useAgentChats.setState
    >[0])
    render(<ChatView chatId="c1" />)
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Stop" }))
    expect(cancelSpy).toHaveBeenCalledWith("c1")
  })

  it("reads Claude Code's file_path and shows the edit's diff", () => {
    useAgentChats.getState().newChat()
    const pickerId = useAgentChats.getState().order[0]!
    useAgentChats.getState().setChatCreated(pickerId, "c1", "claude")
    useAgentChats.getState().appendEvent("c1", {
      kind: "tool_use",
      toolUseId: "u1",
      tool: "Edit",
      input: { file_path: "nodes/a.ts", old_string: "old line", new_string: "new line" },
      status: "completed",
      at: "2026-05-21T00:00:00Z",
    })
    render(<ChatView chatId="c1" />)
    expect(screen.getByText("nodes/a.ts")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /view diff/i }))
    expect(screen.getByTestId("edit-diff").textContent).toContain("+ new line")
  })
})
