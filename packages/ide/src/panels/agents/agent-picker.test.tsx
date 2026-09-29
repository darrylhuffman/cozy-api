import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAgentChats } from "@/store/agent-chats"
import { AgentPicker } from "./agent-picker"

function reset(): void {
  useAgentChats.setState(useAgentChats.getInitialState())
}

const fetchMock = vi.fn()

beforeEach(() => {
  reset()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("AgentPicker", () => {
  it("renders Claude and Codex cards after fetching availability", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          claude: { installed: true, version: "1.2.3" },
          codex: { installed: false },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )
    const pickerId = useAgentChats.getState().newChat()
    render(<AgentPicker pickerId={pickerId} />)
    await waitFor(() => {
      expect(screen.getByText(/Claude Code/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Codex/i)).toBeInTheDocument()
    expect(screen.getByText(/1\.2\.3/)).toBeInTheDocument()
  })

  it("Claude 'Start chat' button is enabled when installed", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          claude: { installed: true },
          codex: { installed: false },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )
    const pickerId = useAgentChats.getState().newChat()
    render(<AgentPicker pickerId={pickerId} />)
    const start = await screen.findByRole("button", { name: /start chat with claude/i })
    expect(start).not.toBeDisabled()
  })

  it("Claude 'Start chat' button is disabled when not installed", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          claude: { installed: false },
          codex: { installed: false },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )
    const pickerId = useAgentChats.getState().newChat()
    render(<AgentPicker pickerId={pickerId} />)
    const start = await screen.findByRole("button", { name: /start chat with claude/i })
    expect(start).toBeDisabled()
  })

  it("Codex card is always disabled and shows 'Coming soon'", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          claude: { installed: true },
          codex: { installed: true, version: "5.0.0" },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )
    const pickerId = useAgentChats.getState().newChat()
    render(<AgentPicker pickerId={pickerId} />)
    await waitFor(() => {
      expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
    })
    const codexStart = screen.getByRole("button", { name: /start chat with codex/i })
    expect(codexStart).toBeDisabled()
  })

  it("clicking Claude 'Start chat' calls store.startClaudeChat", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          claude: { installed: true },
          codex: { installed: false },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )
    const startSpy = vi.fn()
    useAgentChats.setState({ startClaudeChat: startSpy } as unknown as Parameters<
      typeof useAgentChats.setState
    >[0])
    const pickerId = useAgentChats.getState().newChat()
    render(<AgentPicker pickerId={pickerId} />)
    const start = await screen.findByRole("button", { name: /start chat with claude/i })
    fireEvent.click(start)
    expect(startSpy).toHaveBeenCalledWith(pickerId)
  })
})
