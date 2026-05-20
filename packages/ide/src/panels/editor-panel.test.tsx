import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useTabsStore } from "@/store/tabs"
import { EditorPanel } from "./editor-panel.js"

beforeEach(() => {
  localStorage.clear()
  useTabsStore.setState({ tabs: [], activeId: null })
})
afterEach(() => {
  cleanup()
})

describe("EditorPanel", () => {
  it("shows a helpful empty state with no tabs", () => {
    render(<EditorPanel />)
    expect(screen.getByText(/open a file/i)).toBeInTheDocument()
  })

  it("renders a tab when one is open", () => {
    useTabsStore.getState().openTab({ id: "x", title: "x.workflow", kind: "workflow" })
    render(<EditorPanel />)
    expect(screen.getAllByText("x.workflow").length).toBeGreaterThan(0)
    expect(screen.getByText(/Visual workflow editor lands/i)).toBeInTheDocument()
  })

  it("closing a tab removes it", () => {
    useTabsStore.getState().openTab({ id: "x", title: "x.workflow", kind: "workflow" })
    render(<EditorPanel />)
    fireEvent.click(screen.getByRole("button", { name: /close x.workflow/i }))
    expect(useTabsStore.getState().tabs).toEqual([])
  })
})
