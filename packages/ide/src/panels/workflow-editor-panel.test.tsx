import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTabsStore } from "@/store/tabs"
import { WorkflowEditorPanel } from "./workflow-editor-panel.js"

// Stub WorkflowEditor so tests don't trigger real fetch calls
vi.mock("@/workflow/workflow-editor", () => ({
  WorkflowEditor: ({ path }: { path: string }) => <div data-testid="workflow-editor">{path}</div>,
}))

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

describe("WorkflowEditorPanel", () => {
  it("shows a helpful empty state with no workflow tabs", () => {
    render(<WorkflowEditorPanel />)
    expect(screen.getByText(/open a .workflow file/i)).toBeInTheDocument()
  })

  it("renders a tab when a workflow is opened without a path (graceful fallback)", () => {
    useTabsStore.getState().openTab({ id: "x", title: "x.workflow", kind: "workflow" })
    render(<WorkflowEditorPanel />)
    // Tab button appears in the tab strip
    expect(screen.getAllByText("x.workflow").length).toBeGreaterThan(0)
    // Without a path, we show the "re-open" message
    expect(screen.getByText(/re-open it from the file tree/i)).toBeInTheDocument()
  })

  it("renders WorkflowEditor when a workflow tab has a path", () => {
    useTabsStore.getState().openTab({
      id: "x",
      title: "x.workflow",
      kind: "workflow",
      path: "workflows/users/create.workflow",
    })
    render(<WorkflowEditorPanel />)
    expect(screen.getByTestId("workflow-editor")).toBeInTheDocument()
    expect(screen.getByTestId("workflow-editor").textContent).toBe(
      "workflows/users/create.workflow",
    )
  })

  it("does not render node tabs", () => {
    useTabsStore.getState().openTab({ id: "y", title: "y.ts", kind: "node" })
    render(<WorkflowEditorPanel />)
    // Node tabs don't show here — still empty state
    expect(screen.getByText(/open a .workflow file/i)).toBeInTheDocument()
  })

  it("closing a tab removes it from the panel", () => {
    useTabsStore.getState().openTab({ id: "x", title: "x.workflow", kind: "workflow" })
    render(<WorkflowEditorPanel />)
    fireEvent.click(screen.getByRole("button", { name: /close x.workflow/i }))
    expect(useTabsStore.getState().tabs).toEqual([])
    expect(useTabsStore.getState().activeWorkflowId).toBeNull()
  })

  it("selecting a different tab updates activeWorkflowId", () => {
    useTabsStore
      .getState()
      .openTab({ id: "x", title: "x.workflow", kind: "workflow", path: "workflows/x.workflow" })
    useTabsStore
      .getState()
      .openTab({ id: "y", title: "y.workflow", kind: "workflow", path: "workflows/y.workflow" })
    render(<WorkflowEditorPanel />)
    // Click x tab
    fireEvent.click(screen.getByRole("button", { name: "x.workflow" }))
    expect(useTabsStore.getState().activeWorkflowId).toBe("x")
  })
})
