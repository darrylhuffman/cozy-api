import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTabsStore } from "@/store/tabs"
import { EditorPanel } from "./editor-panel.js"

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, path }: { value: string; path: string }) => (
    <div data-testid="monaco-stub" data-path={path}>
      {value}
    </div>
  ),
}))

vi.mock("@/workflow/workflow-editor", () => ({
  WorkflowEditor: ({ path, visible }: { path: string; visible?: boolean }) => (
    <div data-testid="workflow-stub" data-path={path} data-visible={String(visible)} />
  ),
}))

const reset = () =>
  useTabsStore.setState({ tabs: [], activeId: null, activeWorkflowId: null, activeCodeId: null })

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ path: "nodes/y.ts", content: "// stub" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  )
  localStorage.clear()
  reset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  reset()
})

const open = useTabsStore.getState().openTab

describe("EditorPanel", () => {
  it("shows an empty state with no tabs", () => {
    render(<EditorPanel />)
    expect(screen.getByText(/open a workflow or node file/i)).toBeInTheDocument()
  })

  it("shows workflows and code files in one strip", () => {
    open({ id: "w", title: "create.workflow", kind: "workflow", path: "workflows/create.workflow" })
    open({ id: "n", title: "save.ts", kind: "node", path: "nodes/save.ts" })
    render(<EditorPanel />)
    expect(screen.getByRole("button", { name: "create.workflow" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "save.ts" })).toBeInTheDocument()
  })

  it("keeps the workflow mounted but hidden under a code tab", async () => {
    open({ id: "w", title: "a.workflow", kind: "workflow", path: "workflows/a.workflow" })
    open({ id: "n", title: "y.ts", kind: "node", path: "nodes/y.ts" })
    render(<EditorPanel />)
    expect(screen.getByTestId("workflow-stub").getAttribute("data-visible")).toBe("false")
    await waitFor(() => expect(screen.getByTestId("monaco-stub")).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: "a.workflow" }))
    expect(screen.getByTestId("workflow-stub").getAttribute("data-visible")).toBe("true")
    expect(screen.queryByTestId("monaco-stub")).toBeNull()
  })

  it("adds the folder when two tabs share a name", () => {
    open({ id: "a", title: "index.ts", kind: "node", path: "nodes/users/index.ts" })
    open({ id: "b", title: "index.ts", kind: "node", path: "nodes/orders/index.ts" })
    render(<EditorPanel />)
    expect(screen.getByText("users")).toBeInTheDocument()
    expect(screen.getByText("orders")).toBeInTheDocument()
  })

  it("closing the shown tab activates its neighbour", () => {
    open({ id: "w", title: "a.workflow", kind: "workflow", path: "workflows/a.workflow" })
    open({ id: "n", title: "y.ts", kind: "node", path: "nodes/y.ts" })
    render(<EditorPanel />)
    fireEvent.click(screen.getByRole("button", { name: /close y.ts/i }))
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["w"])
    expect(useTabsStore.getState().activeId).toBe("w")
  })
})
