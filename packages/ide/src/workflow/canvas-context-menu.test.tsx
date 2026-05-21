import React from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Popover uses portals which don't render in jsdom — mock it to render inline
vi.mock("@/components/ui/popover", () => ({
  Popover: ({
    open,
    children,
  }: {
    open: boolean
    onOpenChange: (o: boolean) => void
    children: React.ReactNode
  }) => (open ? <div data-testid="popover">{children}</div> : null),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}))

import { CanvasContextMenu } from "./canvas-context-menu"

afterEach(() => {
  cleanup()
})

const schemas = { "@core/response": { color: null, inputs: {}, outputs: {} } }

describe("CanvasContextMenu", () => {
  it("initial render shows action menu items but NOT the palette search input", () => {
    render(
      <CanvasContextMenu
        open
        onOpenChange={vi.fn()}
        x={10}
        y={10}
        schemas={schemas as never}
        onPick={vi.fn()}
        onNewCustomNode={vi.fn()}
      />,
    )
    expect(screen.getByText(/Add existing node/)).toBeInTheDocument()
    expect(screen.getByText(/New custom node/)).toBeInTheDocument()
    // Palette search input should NOT be visible until "Add existing node" is clicked
    expect(screen.queryByPlaceholderText(/Search node types/)).not.toBeInTheDocument()
  })

  it("clicking 'Add existing node' reveals the palette (search input + schema list)", () => {
    render(
      <CanvasContextMenu
        open
        onOpenChange={vi.fn()}
        x={10}
        y={10}
        schemas={schemas as never}
        onPick={vi.fn()}
        onNewCustomNode={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText(/Add existing node/))
    expect(screen.getByPlaceholderText(/Search node types/)).toBeInTheDocument()
    expect(screen.getByText("@core/response")).toBeInTheDocument()
  })

  it("calls onPick and closes when picking from the palette", () => {
    const onPick = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <CanvasContextMenu
        open
        onOpenChange={onOpenChange}
        x={0}
        y={0}
        schemas={schemas as never}
        onPick={onPick}
        onNewCustomNode={vi.fn()}
      />,
    )
    // Navigate to palette first
    fireEvent.click(screen.getByText(/Add existing node/))
    fireEvent.click(screen.getByText("@core/response"))
    expect(onPick).toHaveBeenCalledWith("@core/response")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("'New custom node' calls onNewCustomNode and closes the popover", () => {
    const onNewCustomNode = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <CanvasContextMenu
        open
        onOpenChange={onOpenChange}
        x={0}
        y={0}
        schemas={schemas as never}
        onPick={vi.fn()}
        onNewCustomNode={onNewCustomNode}
      />,
    )
    fireEvent.click(screen.getByText(/New custom node/))
    expect(onNewCustomNode).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("closing and reopening resets back to the action menu", () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <CanvasContextMenu
        open
        onOpenChange={onOpenChange}
        x={0}
        y={0}
        schemas={schemas as never}
        onPick={vi.fn()}
        onNewCustomNode={vi.fn()}
      />,
    )
    // Drill into palette
    fireEvent.click(screen.getByText(/Add existing node/))
    expect(screen.getByPlaceholderText(/Search node types/)).toBeInTheDocument()

    // Close the popover
    rerender(
      <CanvasContextMenu
        open={false}
        onOpenChange={onOpenChange}
        x={0}
        y={0}
        schemas={schemas as never}
        onPick={vi.fn()}
        onNewCustomNode={vi.fn()}
      />,
    )
    // Reopen
    rerender(
      <CanvasContextMenu
        open
        onOpenChange={onOpenChange}
        x={0}
        y={0}
        schemas={schemas as never}
        onPick={vi.fn()}
        onNewCustomNode={vi.fn()}
      />,
    )
    // Should be back at the action menu, not the palette
    expect(screen.getByText(/Add existing node/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Search node types/)).not.toBeInTheDocument()
  })
})
