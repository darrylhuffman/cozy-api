import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CanvasToolbar, type SaveStatus } from "./canvas-toolbar"
import type { Diagnostic } from "./diagnose"

afterEach(cleanup)

function setup(over: Partial<Parameters<typeof CanvasToolbar>[0]> = {}) {
  const props = {
    path: "workflows/users/create.workflow",
    status: "clean" as SaveStatus,
    canUndo: true,
    canRedo: false,
    diagnostics: [] as Diagnostic[],
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSave: vi.fn(),
    onAddNode: vi.fn(),
    onFitView: vi.fn(),
    onTidy: vi.fn(),
    onFocusNode: vi.fn(),
    onShowShortcuts: vi.fn(),
    ...over,
  }
  render(<CanvasToolbar {...props} />)
  return props
}

const problems: Diagnostic[] = [
  { key: "a", severity: "error", nodeId: "save", message: "Missing required input email" },
  { key: "b", severity: "warning", nodeId: null, message: "No Response node" },
]

describe("CanvasToolbar", () => {
  it("shows the path as a breadcrumb without the workflows/ prefix", () => {
    setup()
    expect(screen.getByText("users")).toBeInTheDocument()
    expect(screen.getByText("create.workflow")).toBeInTheDocument()
    expect(screen.queryByText("workflows")).toBeNull()
  })

  it("wires every tool button and disables undo/redo by history", () => {
    const p = setup()
    for (const [label, fn] of [
      ["Undo", p.onUndo],
      ["Add node", p.onAddNode],
      ["Tidy layout", p.onTidy],
      ["Fit view", p.onFitView],
      ["Keyboard shortcuts", p.onShowShortcuts],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: label }))
      expect(fn).toHaveBeenCalledTimes(1)
    }
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled()
  })

  it.each([
    ["clean", null],
    ["saving", "Saving…"],
    ["saved", "Saved"],
    ["error", "Not saved"],
  ] as const)("save status %s", (status, text) => {
    setup({ status })
    if (text) expect(screen.getByText(text)).toBeInTheDocument()
    else expect(screen.queryByText(/unsaved|saving|saved/i)).toBeNull()
  })

  it("the unsaved badge saves when clicked", () => {
    const p = setup({ status: "dirty" })
    fireEvent.click(screen.getByRole("button", { name: /unsaved changes/i }))
    expect(p.onSave).toHaveBeenCalled()
  })
})

describe("ProblemsPopover", () => {
  it("reads 'No problems' for a clean workflow", () => {
    setup()
    fireEvent.click(screen.getByRole("button", { name: "Problems: No problems" }))
    expect(screen.getByText("No problems found in this workflow.")).toBeInTheDocument()
  })

  it("counts errors and warnings and jumps to the node", () => {
    const p = setup({ diagnostics: problems })
    fireEvent.click(screen.getByRole("button", { name: "Problems: 1 error, 1 warning" }))
    const list = screen.getByRole("list", { name: "Problems" })
    expect(list.textContent).toContain("Missing required input email")
    fireEvent.click(screen.getByText("Missing required input email"))
    expect(p.onFocusNode).toHaveBeenCalledWith("save")
  })

  it("workflow-level problems are listed but not clickable", () => {
    setup({ diagnostics: problems })
    fireEvent.click(screen.getByRole("button", { name: /^Problems:/ }))
    expect(screen.getByText("No Response node").closest("button")).toBeDisabled()
  })
})
