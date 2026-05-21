import React from "react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Dialog uses portals which don't render in jsdom — mock it to render inline
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Mock createWorkspaceFile from @/lib/api
vi.mock("@/lib/api", () => ({
  createWorkspaceFile: vi.fn(),
}))

import { createWorkspaceFile } from "@/lib/api"
import { NewNodeDialog } from "./new-node-dialog"

const TEMPLATE = `import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"

export default defineNode({
  inputs: z.object({}),
  outputs: z.object({}),
  async run(input) {
    return {}
  },
})
`

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("NewNodeDialog", () => {
  it("renders when open=true with placeholder path 'nodes/'", () => {
    render(
      <NewNodeDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />,
    )
    expect(screen.getByTestId("dialog")).toBeInTheDocument()
    // Input should have default value "nodes/"
    const input = screen.getByPlaceholderText("nodes/my-node.ts")
    expect(input).toBeInTheDocument()
    expect((input as HTMLInputElement).value).toBe("nodes/")
  })

  it("does not render when open=false", () => {
    render(
      <NewNodeDialog open={false} onOpenChange={vi.fn()} onCreated={vi.fn()} />,
    )
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument()
  })

  it("calls createWorkspaceFile with the right path + template, then onCreated with the right uses", async () => {
    vi.mocked(createWorkspaceFile).mockResolvedValue(undefined)
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <NewNodeDialog open onOpenChange={onOpenChange} onCreated={onCreated} />,
    )

    // Type a path
    const input = screen.getByPlaceholderText("nodes/my-node.ts")
    fireEvent.change(input, { target: { value: "nodes/save-user" } })

    // Click Create
    await act(async () => {
      fireEvent.click(screen.getByText("Create"))
    })

    expect(createWorkspaceFile).toHaveBeenCalledWith("nodes/save-user.ts", TEMPLATE)
    expect(onCreated).toHaveBeenCalledWith("./nodes/save-user")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("appends .ts extension automatically if not present", async () => {
    vi.mocked(createWorkspaceFile).mockResolvedValue(undefined)
    const onCreated = vi.fn()
    render(
      <NewNodeDialog open onOpenChange={vi.fn()} onCreated={onCreated} />,
    )

    const input = screen.getByPlaceholderText("nodes/my-node.ts")
    fireEvent.change(input, { target: { value: "nodes/my-node" } })

    await act(async () => {
      fireEvent.click(screen.getByText("Create"))
    })

    expect(createWorkspaceFile).toHaveBeenCalledWith("nodes/my-node.ts", TEMPLATE)
    expect(onCreated).toHaveBeenCalledWith("./nodes/my-node")
  })

  it("does not append .ts when already present", async () => {
    vi.mocked(createWorkspaceFile).mockResolvedValue(undefined)
    const onCreated = vi.fn()
    render(
      <NewNodeDialog open onOpenChange={vi.fn()} onCreated={onCreated} />,
    )

    const input = screen.getByPlaceholderText("nodes/my-node.ts")
    fireEvent.change(input, { target: { value: "nodes/already.ts" } })

    await act(async () => {
      fireEvent.click(screen.getByText("Create"))
    })

    expect(createWorkspaceFile).toHaveBeenCalledWith("nodes/already.ts", TEMPLATE)
    expect(onCreated).toHaveBeenCalledWith("./nodes/already")
  })

  it("shows error inline when createWorkspaceFile throws (409 file exists); onCreated NOT called", async () => {
    vi.mocked(createWorkspaceFile).mockRejectedValue(new Error("File already exists"))
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <NewNodeDialog open onOpenChange={onOpenChange} onCreated={onCreated} />,
    )

    const input = screen.getByPlaceholderText("nodes/my-node.ts")
    fireEvent.change(input, { target: { value: "nodes/existing" } })

    await act(async () => {
      fireEvent.click(screen.getByText("Create"))
    })

    await waitFor(() => {
      expect(screen.getByText("File already exists")).toBeInTheDocument()
    })
    expect(onCreated).not.toHaveBeenCalled()
    // Dialog stays open
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
