import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TreeContextMenu } from "./tree-context-menu"

// Popover uses portals — render its content inline for jsdom
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="popover">{children}</div> : null,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

afterEach(() => cleanup())

describe("TreeContextMenu", () => {
  it("renders New folder and New workflow when tree=workflows", () => {
    render(
      <TreeContextMenu
        open
        onOpenChange={vi.fn()}
        x={0}
        y={0}
        tree="workflows"
        onNewFolder={vi.fn()}
        onNewItem={vi.fn()}
      />,
    )
    expect(screen.getByText(/New folder/)).toBeInTheDocument()
    expect(screen.getByText(/New workflow/)).toBeInTheDocument()
    expect(screen.queryByText(/New node/)).not.toBeInTheDocument()
  })

  it("renders New folder and New node when tree=nodes", () => {
    render(
      <TreeContextMenu
        open
        onOpenChange={vi.fn()}
        x={0}
        y={0}
        tree="nodes"
        onNewFolder={vi.fn()}
        onNewItem={vi.fn()}
      />,
    )
    expect(screen.getByText(/New folder/)).toBeInTheDocument()
    expect(screen.getByText(/New node/)).toBeInTheDocument()
    expect(screen.queryByText(/New workflow/)).not.toBeInTheDocument()
  })

  it("clicking New folder closes the menu and fires onNewFolder", () => {
    const onOpenChange = vi.fn()
    const onNewFolder = vi.fn()
    render(
      <TreeContextMenu
        open
        onOpenChange={onOpenChange}
        x={0}
        y={0}
        tree="workflows"
        onNewFolder={onNewFolder}
        onNewItem={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText(/New folder/))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onNewFolder).toHaveBeenCalled()
  })

  it("clicking New workflow closes the menu and fires onNewItem", () => {
    const onOpenChange = vi.fn()
    const onNewItem = vi.fn()
    render(
      <TreeContextMenu
        open
        onOpenChange={onOpenChange}
        x={0}
        y={0}
        tree="workflows"
        onNewFolder={vi.fn()}
        onNewItem={onNewItem}
      />,
    )
    fireEvent.click(screen.getByText(/New workflow/))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onNewItem).toHaveBeenCalled()
  })

  it("does not render when open=false", () => {
    render(
      <TreeContextMenu
        open={false}
        onOpenChange={vi.fn()}
        x={0}
        y={0}
        tree="nodes"
        onNewFolder={vi.fn()}
        onNewItem={vi.fn()}
      />,
    )
    expect(screen.queryByTestId("popover")).not.toBeInTheDocument()
  })
})
