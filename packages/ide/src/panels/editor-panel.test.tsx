import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useConfirmStore } from "@/store/confirm"
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

  describe("tab context menu", () => {
    const openThree = () => {
      open({ id: "a", title: "a.ts", kind: "node", path: "nodes/a.ts" })
      open({ id: "b", title: "b.ts", kind: "node", path: "nodes/b.ts" })
      open({ id: "c", title: "c.ts", kind: "node", path: "nodes/c.ts" })
    }
    const menuFor = (title: string) => {
      const tab = screen.getByRole("button", { name: title }).parentElement as HTMLElement
      fireEvent.contextMenu(tab)
    }
    const ids = () => useTabsStore.getState().tabs.map((t) => t.id)

    it("closes the other tabs and keeps the right-clicked one", () => {
      openThree()
      render(<EditorPanel />)
      menuFor("b.ts")
      fireEvent.click(screen.getByRole("menuitem", { name: "Close others" }))
      expect(ids()).toEqual(["b"])
      expect(useTabsStore.getState().activeId).toBe("b")
    })

    it("closes tabs to the right", () => {
      openThree()
      render(<EditorPanel />)
      menuFor("a.ts")
      fireEvent.click(screen.getByRole("menuitem", { name: "Close to the right" }))
      expect(ids()).toEqual(["a"])
    })

    it("asks once before closing tabs with unsaved changes", async () => {
      openThree()
      // Two inactive tabs (the active one's editor resets its flag on load).
      useTabsStore.getState().setDirty("a", true)
      useTabsStore.getState().setDirty("b", true)
      render(<EditorPanel />)
      menuFor("c.ts")
      fireEvent.click(screen.getByRole("menuitem", { name: "Close all" }))
      await waitFor(() => expect(useConfirmStore.getState().pending).not.toBeNull())
      expect(useConfirmStore.getState().pending?.title).toBe("Close 2 tabs without saving?")
      useConfirmStore.getState().answer(true)
      await waitFor(() => expect(ids()).toEqual([]))
    })

    it("Close saved leaves dirty tabs open", () => {
      openThree()
      useTabsStore.getState().setDirty("b", true)
      render(<EditorPanel />)
      menuFor("a.ts")
      fireEvent.click(screen.getByRole("menuitem", { name: "Close saved" }))
      expect(ids()).toEqual(["b"])
    })
  })

  it("moveTab reorders tabs", () => {
    open({ id: "a", title: "a.ts", kind: "node", path: "nodes/a.ts" })
    open({ id: "b", title: "b.ts", kind: "node", path: "nodes/b.ts" })
    open({ id: "c", title: "c.ts", kind: "node", path: "nodes/c.ts" })
    useTabsStore.getState().moveTab("c", 0)
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["c", "a", "b"])
    useTabsStore.getState().moveTab("c", 99)
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["a", "b", "c"])
  })
})
