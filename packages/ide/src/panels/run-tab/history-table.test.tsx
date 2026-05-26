import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useRequestHistoryStore } from "@/store/request-history"
import { HistoryTable } from "./history-table"

describe("HistoryTable", () => {
  afterEach(() => {
    cleanup()
    useRequestHistoryStore.setState({ entries: [] })
  })

  it("renders empty state when there are no entries", () => {
    render(<HistoryTable />)
    expect(screen.getByText(/no requests yet/i)).toBeInTheDocument()
  })

  it("renders one row per entry", () => {
    useRequestHistoryStore.getState().addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "POST", path: "/a" }, startedAt: 1000 })
    useRequestHistoryStore.getState().addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/b" }, startedAt: 1001 })
    render(<HistoryTable />)
    expect(screen.getAllByTestId("history-row")).toHaveLength(2)
  })

  it("shows spinner for in-flight entries", () => {
    useRequestHistoryStore.getState().addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    render(<HistoryTable />)
    expect(screen.getByTestId("status-in-flight")).toBeInTheDocument()
  })

  it("shows green dot for status<400", () => {
    const id = useRequestHistoryStore.getState().addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    useRequestHistoryStore.getState().setResponse(id, { status: 200, headers: {}, body: null, durationMs: 1 })
    render(<HistoryTable />)
    expect(screen.getByTestId("status-ok")).toBeInTheDocument()
  })

  it("shows red dot for status>=400", () => {
    const id = useRequestHistoryStore.getState().addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    useRequestHistoryStore.getState().setResponse(id, { status: 500, headers: {}, body: { error: "boom" }, durationMs: 1 })
    render(<HistoryTable />)
    expect(screen.getByTestId("status-error")).toBeInTheDocument()
  })

  it("shows gray dot for network error", () => {
    const id = useRequestHistoryStore.getState().addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    useRequestHistoryStore.getState().setError(id, "refused")
    render(<HistoryTable />)
    expect(screen.getByTestId("status-network-error")).toBeInTheDocument()
  })

  it("expands a row on click to show response details", () => {
    const id = useRequestHistoryStore.getState().addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    useRequestHistoryStore.getState().setResponse(id, { status: 200, headers: { "content-type": "application/json" }, body: { ok: true }, durationMs: 7 })
    render(<HistoryTable />)
    expect(screen.queryByTestId("response-details")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId("history-row"))
    expect(screen.getByTestId("response-details")).toBeInTheDocument()
  })
})
