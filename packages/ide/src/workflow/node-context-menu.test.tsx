import React from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Popover uses portals — mock to render inline
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

import { NodeContextMenu } from "./node-context-menu"

afterEach(() => {
  cleanup()
})

describe("NodeContextMenu", () => {
  it("renders both action buttons when open", () => {
    render(
      <NodeContextMenu
        open
        onOpenChange={vi.fn()}
        x={100}
        y={200}
        onDelete={vi.fn()}
        onReset={vi.fn()}
      />,
    )
    expect(screen.getByText("Reset connections")).toBeInTheDocument()
    expect(screen.getByText("Delete node")).toBeInTheDocument()
  })

  it("does not render anything when closed", () => {
    render(
      <NodeContextMenu
        open={false}
        onOpenChange={vi.fn()}
        x={100}
        y={200}
        onDelete={vi.fn()}
        onReset={vi.fn()}
      />,
    )
    expect(screen.queryByText("Reset connections")).not.toBeInTheDocument()
    expect(screen.queryByText("Delete node")).not.toBeInTheDocument()
  })

  it("clicking Reset connections calls onReset and closes the popover", () => {
    const onReset = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <NodeContextMenu
        open
        onOpenChange={onOpenChange}
        x={0}
        y={0}
        onDelete={vi.fn()}
        onReset={onReset}
      />,
    )
    fireEvent.click(screen.getByText("Reset connections"))
    expect(onReset).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("clicking Delete node calls onDelete and closes the popover", () => {
    const onDelete = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <NodeContextMenu
        open
        onOpenChange={onOpenChange}
        x={0}
        y={0}
        onDelete={onDelete}
        onReset={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText("Delete node"))
    expect(onDelete).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("does not show 'View source' when onViewSource is not provided", () => {
    render(
      <NodeContextMenu
        open
        onOpenChange={vi.fn()}
        x={0}
        y={0}
        onDelete={vi.fn()}
        onReset={vi.fn()}
      />,
    )
    expect(screen.queryByText("View source")).not.toBeInTheDocument()
  })

  it("shows 'View source' when onViewSource is provided", () => {
    render(
      <NodeContextMenu
        open
        onOpenChange={vi.fn()}
        x={0}
        y={0}
        onDelete={vi.fn()}
        onReset={vi.fn()}
        onViewSource={vi.fn()}
      />,
    )
    expect(screen.getByText("View source")).toBeInTheDocument()
  })

  it("clicking 'View source' calls onViewSource and closes the popover", () => {
    const onViewSource = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <NodeContextMenu
        open
        onOpenChange={onOpenChange}
        x={0}
        y={0}
        onDelete={vi.fn()}
        onReset={vi.fn()}
        onViewSource={onViewSource}
      />,
    )
    fireEvent.click(screen.getByText("View source"))
    expect(onViewSource).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
