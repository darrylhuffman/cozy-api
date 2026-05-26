import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useDebugSessionStore } from "@/store/debug-session"
import type { ServerMessage } from "@darrylondil/lorien-runtime"
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

  it("renders Timeline + Logs tabs when a run is selected", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.selectRun("rA")
    render(<SelectedRunView />)
    expect(screen.getByText("Timeline")).toBeInTheDocument()
    expect(screen.getByText("Logs")).toBeInTheDocument()
  })

  it("tab buttons toggle which view shows", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.selectRun("rA")
    render(<SelectedRunView />)
    fireEvent.click(screen.getByText("Logs"))
    expect(screen.getByText(/Logs view/i)).toBeInTheDocument()
  })
})
