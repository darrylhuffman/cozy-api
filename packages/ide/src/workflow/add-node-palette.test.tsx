import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AddNodePalette } from "./add-node-palette"

afterEach(() => {
  cleanup()
})

const schemas = {
  "@core/http-request": { color: null, inputs: {}, outputs: {} },
  "@core/response": { color: null, inputs: {}, outputs: {} },
  "./nodes/save-user": { color: null, inputs: {}, outputs: {} },
}

describe("AddNodePalette", () => {
  it("lists all schema keys", () => {
    render(<AddNodePalette schemas={schemas as never} onPick={vi.fn()} />)
    expect(screen.getByText("@core/http-request")).toBeInTheDocument()
    expect(screen.getByText("@core/response")).toBeInTheDocument()
    expect(screen.getByText("./nodes/save-user")).toBeInTheDocument()
  })

  it("filters by search query", () => {
    render(<AddNodePalette schemas={schemas as never} onPick={vi.fn()} />)
    const input = screen.getByPlaceholderText(/search/i)
    fireEvent.change(input, { target: { value: "save" } })
    expect(screen.queryByText("@core/http-request")).not.toBeInTheDocument()
    expect(screen.getByText("./nodes/save-user")).toBeInTheDocument()
  })

  it("calls onPick with the chosen `uses` when an item is clicked", () => {
    const onPick = vi.fn()
    render(<AddNodePalette schemas={schemas as never} onPick={onPick} />)
    fireEvent.click(screen.getByText("@core/response"))
    expect(onPick).toHaveBeenCalledWith("@core/response")
  })
})
