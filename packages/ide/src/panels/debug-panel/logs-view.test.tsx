import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useDebugSessionStore } from "@/store/debug-session"
import type { ServerMessage } from "@darrylondil/lorien-runtime"
import { LogsView } from "./logs-view"

describe("LogsView", () => {
  afterEach(() => {
    cleanup()
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState() as never)
  })

  it("renders empty state for a run with no logs", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    render(<LogsView runId="rA" />)
    expect(screen.getByText(/no logs/i)).toBeInTheDocument()
  })

  it("renders one row per log entry", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "log", runId: "rA", level: "info", message: "hello", offsetMs: 5 } as ServerMessage)
    s.applyMessage({ type: "log", runId: "rA", level: "warn", message: "be careful", offsetMs: 10 } as ServerMessage)
    render(<LogsView runId="rA" />)
    expect(screen.getAllByTestId("log-row")).toHaveLength(2)
  })

  it("filter input narrows by message substring", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "log", runId: "rA", level: "info", message: "alpha", offsetMs: 5 } as ServerMessage)
    s.applyMessage({ type: "log", runId: "rA", level: "info", message: "beta", offsetMs: 6 } as ServerMessage)
    render(<LogsView runId="rA" />)
    fireEvent.change(screen.getByPlaceholderText(/filter/i), { target: { value: "alph" } })
    expect(screen.getAllByTestId("log-row")).toHaveLength(1)
  })

  it("surfaces error events with their stack", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({
      type: "event",
      runId: "rA",
      event: { type: "error", nodeId: "x", error: { message: "boom", stack: "Error: boom\n  at x" } },
      offsetMs: 5,
    } as ServerMessage)
    render(<LogsView runId="rA" />)
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })
})
