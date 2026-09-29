import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EditorTabStrip } from "./editor-tab-strip"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const tabs = [
  { id: "a", title: "a.workflow", hint: "workflows/a.workflow" },
  { id: "b", title: "b.workflow", dirty: true },
]

/** jsdom has no layout: fake an overflowing strip scrolled to `left`. */
function overflow(left: number) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype, "scrollLeft", "get").mockReturnValue(left)
}

describe("EditorTabStrip", () => {
  it("selects, closes and middle-click closes tabs", () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<EditorTabStrip tabs={tabs} activeId="a" onSelect={onSelect} onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: "b.workflow •" }))
    expect(onSelect).toHaveBeenCalledWith("b")
    fireEvent.click(screen.getByRole("button", { name: "Close a.workflow" }))
    expect(onClose).toHaveBeenCalledWith("a")
    fireEvent.mouseDown(screen.getByText("a.workflow").parentElement!, { button: 1 })
    expect(onClose).toHaveBeenLastCalledWith("a")
    expect(screen.getByRole("button", { name: "a.workflow" })).toHaveAttribute(
      "title",
      "workflows/a.workflow",
    )
  })

  it("shows no arrows when everything fits", () => {
    render(<EditorTabStrip tabs={tabs} activeId="a" onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole("button", { name: /Scroll tabs/ })).toBeNull()
  })

  it("shows only the right arrow at the start of an overflowing strip", () => {
    overflow(0)
    render(<EditorTabStrip tabs={tabs} activeId="a" onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "Scroll tabs left" })).toBeNull()
    expect(screen.getByRole("button", { name: "Scroll tabs right" })).toBeInTheDocument()
  })

  it("shows both arrows in the middle and scrolls when one is clicked", () => {
    overflow(200)
    const scrollBy = vi.fn()
    HTMLElement.prototype.scrollBy = scrollBy
    render(<EditorTabStrip tabs={tabs} activeId="a" onSelect={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Scroll tabs left" }))
    expect(scrollBy).toHaveBeenCalledWith({ left: -200, behavior: "smooth" })
    fireEvent.click(screen.getByRole("button", { name: "Scroll tabs right" }))
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 200, behavior: "smooth" })
  })
})
