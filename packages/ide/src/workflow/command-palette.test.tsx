import React from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Dialog uses portals which don't render in jsdom — mock it to render inline
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
}))

import { CommandPalette } from "./command-palette"

afterEach(() => {
  cleanup()
})

const schemas = { "@core/response": { color: null, inputs: {}, outputs: {} } }

describe("CommandPalette", () => {
  it("opens on Ctrl+K and lists schemas", () => {
    render(<CommandPalette schemas={schemas as never} onPick={vi.fn()} />)
    expect(screen.queryByText("@core/response")).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    expect(screen.getByText("@core/response")).toBeInTheDocument()
  })

  it("calls onPick and closes when an item is selected", () => {
    const onPick = vi.fn()
    render(<CommandPalette schemas={schemas as never} onPick={onPick} />)
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.click(screen.getByText("@core/response"))
    expect(onPick).toHaveBeenCalledWith("@core/response")
    expect(screen.queryByText("@core/response")).not.toBeInTheDocument()
  })

  it("Escape closes without calling onPick", () => {
    const onPick = vi.fn()
    render(<CommandPalette schemas={schemas as never} onPick={onPick} />)
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.queryByText("@core/response")).not.toBeInTheDocument()
  })
})
