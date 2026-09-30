import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/ai/ask", () => ({ askAi: vi.fn() }))

import { askAi } from "@/ai/ask"
import { type RunRecord, useDebugSessionStore } from "@/store/debug-session"
import { StatusBanner } from "./status-banner"

const run = (outcome: RunRecord["outcome"]): RunRecord => ({
  runId: "r",
  workflowPath: "workflows/u.workflow",
  triggerNodeId: "req",
  request: { method: "GET", path: "/" },
  startedAt: 0,
  events: [],
  logs: [],
  pausedFrame: null,
  outcome,
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useDebugSessionStore.setState({ runs: [] })
})

describe("StatusBanner", () => {
  it("offers Ask AI to fix on a failed run", () => {
    useDebugSessionStore.setState({
      runs: [run({ kind: "errored", nodeId: "save", message: "db down" })],
    })
    render(<StatusBanner runId="r" />)
    expect(screen.getByTestId("status-banner")).toHaveTextContent("Errored in save: db down")
    fireEvent.click(screen.getByRole("button", { name: "Ask AI to fix" }))
    expect(vi.mocked(askAi).mock.calls[0]![0].title).toBe("Fix save failure")
  })

  it("has no AI button on a successful run", () => {
    useDebugSessionStore.setState({
      runs: [run({ kind: "ok", status: 200, body: {}, totalMs: 4 })],
    })
    render(<StatusBanner runId="r" />)
    expect(screen.getByTestId("status-banner")).toHaveTextContent("Completed200 · 4ms")
    expect(screen.queryByRole("button", { name: "Ask AI to fix" })).toBeNull()
  })

  it("omits the node when the run error has none", () => {
    useDebugSessionStore.setState({ runs: [run({ kind: "errored", message: "boom" })] })
    render(<StatusBanner runId="r" />)
    expect(screen.getByTestId("status-banner")).toHaveTextContent(/^Errored: boom/)
  })

  it("wires the paused controls to the session store", () => {
    const sendContinue = vi.fn()
    const sendStep = vi.fn()
    const sendStepOver = vi.fn()
    const sendStop = vi.fn()
    useDebugSessionStore.setState({
      runs: [
        {
          ...run({ kind: "paused" }),
          pausedFrame: { nodeId: "save", phase: "before", payload: null },
        },
      ],
      sendContinue,
      sendStep,
      sendStepOver,
      sendStop,
    })
    render(<StatusBanner runId="r" />)
    expect(screen.getByTestId("status-banner")).toHaveTextContent("Paused at save.before")
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    fireEvent.click(screen.getByRole("button", { name: "Step" }))
    fireEvent.click(screen.getByRole("button", { name: "Step Over" }))
    fireEvent.click(screen.getByRole("button", { name: "Stop" }))
    for (const fn of [sendContinue, sendStep, sendStepOver, sendStop])
      expect(fn).toHaveBeenCalledWith("r")
  })
})
