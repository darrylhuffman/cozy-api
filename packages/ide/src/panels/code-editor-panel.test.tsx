import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTabsStore } from "@/store/tabs"
import { CodeEditorPanel } from "./code-editor-panel.js"

function resetStore() {
  useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
}

beforeEach(() => {
  localStorage.clear()
  resetStore()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetStore()
})

describe("CodeEditorPanel", () => {
  it("shows a helpful empty state with no node tabs", () => {
    render(<CodeEditorPanel />)
    expect(screen.getByText(/open a .ts node file/i)).toBeInTheDocument()
  })

  it("renders a node tab when opened", () => {
    useTabsStore.getState().openTab({ id: "y", title: "y.ts", kind: "node", path: "nodes/y.ts" })
    render(<CodeEditorPanel />)
    expect(screen.getAllByText("y.ts").length).toBeGreaterThan(0)
    expect(screen.getByText(/Monaco-based code editor lands/i)).toBeInTheDocument()
  })

  it("does not render workflow tabs", () => {
    useTabsStore.getState().openTab({ id: "x", title: "x.workflow", kind: "workflow" })
    render(<CodeEditorPanel />)
    // Workflow tabs don't show here — still empty state
    expect(screen.getByText(/open a .ts node file/i)).toBeInTheDocument()
  })

  it("shows path info for active node tab", () => {
    useTabsStore
      .getState()
      .openTab({ id: "y", title: "y.ts", kind: "node", path: "nodes/shared/y.ts" })
    render(<CodeEditorPanel />)
    expect(screen.getByText(/nodes\/shared\/y\.ts/)).toBeInTheDocument()
  })

  it("closing a tab removes it from the panel", () => {
    useTabsStore.getState().openTab({ id: "y", title: "y.ts", kind: "node" })
    render(<CodeEditorPanel />)
    fireEvent.click(screen.getByRole("button", { name: /close y.ts/i }))
    expect(useTabsStore.getState().tabs).toEqual([])
    expect(useTabsStore.getState().activeCodeId).toBeNull()
  })

  it("selecting a different node tab updates activeCodeId", () => {
    useTabsStore.getState().openTab({ id: "y", title: "y.ts", kind: "node", path: "nodes/y.ts" })
    useTabsStore.getState().openTab({ id: "z", title: "z.ts", kind: "node", path: "nodes/z.ts" })
    render(<CodeEditorPanel />)
    // Click y tab
    fireEvent.click(screen.getByRole("button", { name: "y.ts" }))
    expect(useTabsStore.getState().activeCodeId).toBe("y")
  })
})
