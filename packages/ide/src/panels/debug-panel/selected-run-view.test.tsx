import type { ServerMessage } from "@darrylondil/lorien-runtime"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { useDebugSessionStore } from "@/store/debug-session"
import { SelectedRunView } from "./selected-run-view"

describe("SelectedRunView", () => {
  afterEach(() => {
    cleanup()
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState() as never)
  })

  it("renders empty state when no run is selected", () => {
    render(<SelectedRunView />)
    expect(screen.getByText(/select a run/i)).toBeInTheDocument()
  })

  it("renders Timeline + Logs sections when a run is selected", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({
      type: "event",
      runId: "rA",
      event: { type: "before-node", nodeId: "x", input: {} },
      offsetMs: 0,
    } as ServerMessage)
    s.selectRun("rA")
    render(<SelectedRunView />)
    expect(screen.getByText("Timeline")).toBeInTheDocument()
    expect(screen.getByText("Logs")).toBeInTheDocument()
  })

  it("shows the timeline and logs side by side, with no tab switching", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({
      type: "event",
      runId: "rA",
      event: { type: "before-node", nodeId: "x", input: {} },
      offsetMs: 0,
    } as ServerMessage)
    s.selectRun("rA")
    render(<SelectedRunView />)
    const timeline = screen.getByRole("region", { name: "Timeline" })
    const logs = screen.getByRole("region", { name: "Logs" })
    expect(within(timeline).getByText("x")).toBeInTheDocument()
    expect(within(logs).getByText(/no logs/i)).toBeInTheDocument()
  })

  it("expands a timeline row to show its input", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({
      type: "event",
      runId: "rA",
      event: { type: "before-node", nodeId: "x", input: { sku: "A1" } },
      offsetMs: 0,
    } as ServerMessage)
    s.selectRun("rA")
    render(<SelectedRunView />)
    fireEvent.click(screen.getByRole("button", { name: /before x/ }))
    expect(screen.getByText(/"sku": "A1"/)).toBeInTheDocument()
  })
})
