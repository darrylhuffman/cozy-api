import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTabsStore } from "@/store/tabs"
import { CodeEditorPanel } from "./code-editor-panel.js"

// Monaco can't run in jsdom — mock it out at the panel-test level too
vi.mock("@monaco-editor/react", () => ({
  default: ({ value, path }: { value: string; path: string }) => (
    <div data-testid="monaco-stub" data-path={path}>
      {value}
    </div>
  ),
}))

// Stub fetch so CodeEditor doesn't hang waiting for the API
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation((_input) => {
    return Promise.resolve(
      new Response(JSON.stringify({ path: "nodes/y.ts", content: "// stub file content" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
  })
  localStorage.clear()
  useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
})

describe("CodeEditorPanel", () => {
  it("shows a helpful empty state with no node tabs", () => {
    render(<CodeEditorPanel />)
    expect(screen.getByText(/open a .ts node file/i)).toBeInTheDocument()
  })

  it("renders a node tab when opened and shows Monaco editor", async () => {
    useTabsStore.getState().openTab({ id: "y", title: "y.ts", kind: "node", path: "nodes/y.ts" })
    render(<CodeEditorPanel />)
    expect(screen.getAllByText("y.ts").length).toBeGreaterThan(0)
    // Monaco stub should appear after fetch resolves
    await waitFor(() => expect(screen.getByTestId("monaco-stub")).toBeInTheDocument())
  })

  it("does not render workflow tabs", () => {
    useTabsStore.getState().openTab({ id: "x", title: "x.workflow", kind: "workflow" })
    render(<CodeEditorPanel />)
    // Workflow tabs don't show here — still empty state
    expect(screen.getByText(/open a .ts node file/i)).toBeInTheDocument()
  })

  it("shows the Monaco editor for a tab with a path", async () => {
    useTabsStore
      .getState()
      .openTab({ id: "y", title: "y.ts", kind: "node", path: "nodes/shared/y.ts" })
    render(<CodeEditorPanel />)
    await waitFor(() => expect(screen.getByTestId("monaco-stub")).toBeInTheDocument())
    expect(screen.getByTestId("monaco-stub").getAttribute("data-path")).toBe("nodes/shared/y.ts")
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
