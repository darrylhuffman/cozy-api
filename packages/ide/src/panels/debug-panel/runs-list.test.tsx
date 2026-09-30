import type { ServerMessage } from "@darrylondil/lorien-runtime"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { useDebugSessionStore } from "@/store/debug-session"
import { RunsList } from "./runs-list"

describe("RunsList", () => {
  afterEach(() => {
    cleanup()
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState() as never)
  })

  it("renders empty state when no runs", () => {
    render(<RunsList />)
    expect(screen.getByText(/no runs/i)).toBeInTheDocument()
  })

  it("renders one row per run", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({
      type: "event",
      runId: "rA",
      event: { type: "before-node", nodeId: "x", input: {} },
      offsetMs: 0,
    } as ServerMessage)
    s.applyMessage({
      type: "event",
      runId: "rB",
      event: { type: "before-node", nodeId: "y", input: {} },
      offsetMs: 0,
    } as ServerMessage)
    render(<RunsList />)
    expect(screen.getAllByTestId("runs-row")).toHaveLength(2)
  })

  it("clicking a row changes selectedRunId", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({
      type: "event",
      runId: "rA",
      event: { type: "before-node", nodeId: "x", input: {} },
      offsetMs: 0,
    } as ServerMessage)
    s.applyMessage({
      type: "event",
      runId: "rB",
      event: { type: "before-node", nodeId: "y", input: {} },
      offsetMs: 0,
    } as ServerMessage)
    render(<RunsList />)
    const rows = screen.getAllByTestId("runs-row")
    // After lazy-create, selectedRunId is set to rA (first event's runId). New runs are
    // prepended, so rows[0] is rB (not selected) and rows[1] is rA (selected). Clicking
    // the first row (rB) should change selectedRunId away from rA.
    const initialSelected = useDebugSessionStore.getState().selectedRunId
    fireEvent.click(rows[0]!)
    expect(useDebugSessionStore.getState().selectedRunId).not.toBe(initialSelected)
  })

  it("labels each row with a status pill and marks the selected row", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({
      type: "event",
      runId: "rA",
      event: { type: "before-node", nodeId: "x", input: {} },
      offsetMs: 0,
    } as ServerMessage)
    render(<RunsList />)
    const [row] = screen.getAllByTestId("runs-row")
    expect(row).toHaveTextContent(/running/i)
    expect(row).toHaveAttribute("aria-current", "true")
  })
})
