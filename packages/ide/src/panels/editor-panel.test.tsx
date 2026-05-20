import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTabsStore } from "@/store/tabs"
import { EditorPanel } from "./editor-panel.js"

// Stub WorkflowEditor so tests don't trigger real fetch calls
vi.mock("@/workflow/workflow-editor", () => ({
  WorkflowEditor: ({ path }: { path: string }) => (
    <div data-testid="workflow-editor">{path}</div>
  ),
}))

beforeEach(() => {
  localStorage.clear()
  useTabsStore.setState({ tabs: [], activeId: null })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("EditorPanel", () => {
  it("shows a helpful empty state with no tabs", () => {
    render(<EditorPanel />)
    expect(screen.getByText(/open a file/i)).toBeInTheDocument()
  })

  it("renders a tab when a workflow is opened without a path (graceful fallback)", () => {
    useTabsStore.getState().openTab({ id: "x", title: "x.workflow", kind: "workflow" })
    render(<EditorPanel />)
    // Tab button appears in the tab strip
    expect(screen.getAllByText("x.workflow").length).toBeGreaterThan(0)
    // Without a path, we show the "no path available" message
    expect(screen.getByText(/no file path available/i)).toBeInTheDocument()
  })

  it("renders WorkflowEditor when a workflow tab has a path", () => {
    useTabsStore
      .getState()
      .openTab({ id: "x", title: "x.workflow", kind: "workflow", path: "workflows/users/create.workflow" })
    render(<EditorPanel />)
    expect(screen.getByTestId("workflow-editor")).toBeInTheDocument()
    expect(screen.getByTestId("workflow-editor").textContent).toBe("workflows/users/create.workflow")
  })

  it("shows Monaco placeholder for node tabs", () => {
    useTabsStore.getState().openTab({ id: "y", title: "y.ts", kind: "node" })
    render(<EditorPanel />)
    expect(screen.getByText(/Monaco-based code editor lands/i)).toBeInTheDocument()
  })

  it("closing a tab removes it", () => {
    useTabsStore.getState().openTab({ id: "x", title: "x.workflow", kind: "workflow" })
    render(<EditorPanel />)
    fireEvent.click(screen.getByRole("button", { name: /close x.workflow/i }))
    expect(useTabsStore.getState().tabs).toEqual([])
  })
})
