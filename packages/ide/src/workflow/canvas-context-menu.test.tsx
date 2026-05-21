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
  it("shows palette + New custom node when open", () => {
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
    expect(screen.getByText("@core/response")).toBeInTheDocument()
    expect(screen.getByText(/New custom node/)).toBeInTheDocument()
  })

  it("calls onPick and closes when picking", () => {
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
    fireEvent.click(screen.getByText("@core/response"))
    expect(onPick).toHaveBeenCalledWith("@core/response")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
