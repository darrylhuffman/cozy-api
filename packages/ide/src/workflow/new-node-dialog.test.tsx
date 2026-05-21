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

vi.mock("@/lib/api", () => ({
  createWorkspaceFile: vi.fn(),
  fetchWorkspaceTree: vi.fn(),
}))

import { createWorkspaceFile, fetchWorkspaceTree } from "@/lib/api"
import type { FileFolder } from "@/data/mock-files"
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

const nodesTree: FileFolder = {
  type: "folder",
  id: "n-root",
  name: "nodes",
  children: [
    {
      type: "folder",
      id: "n-shared",
      name: "shared",
      children: [],
    },
  ],
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("NewNodeDialog", () => {
  it("renders with the default folder shown and an empty name input", () => {
    render(
      <NewNodeDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        defaultFolder="nodes"
        nodesTree={nodesTree}
      />,
    )
    expect(screen.getByTestId("dialog")).toBeInTheDocument()
    expect(screen.getByText("nodes")).toBeInTheDocument()
    const nameInput = screen.getByPlaceholderText(/my-node/i) as HTMLInputElement
    expect(nameInput.value).toBe("")
  })

  it("uses defaultFolder when provided", () => {
    render(
      <NewNodeDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        defaultFolder="nodes/shared"
        nodesTree={nodesTree}
      />,
    )
    expect(screen.getByText("nodes/shared")).toBeInTheDocument()
  })

  it("toggles the folder picker when Change is clicked", () => {
    render(
      <NewNodeDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        defaultFolder="nodes"
        nodesTree={nodesTree}
      />,
    )
    expect(screen.queryByTestId("folder-picker")).not.toBeInTheDocument()
    fireEvent.click(screen.getByText("Change"))
    expect(screen.getByTestId("folder-picker")).toBeInTheDocument()
  })

  it("calls createWorkspaceFile with <folder>/<name>.ts and the template, then onCreated", async () => {
    vi.mocked(createWorkspaceFile).mockResolvedValue(undefined)
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <NewNodeDialog
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
        defaultFolder="nodes/shared"
        nodesTree={nodesTree}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText(/my-node/i), {
      target: { value: "save-user" },
    })
    await act(async () => {
      fireEvent.click(screen.getByText("Create"))
    })
    expect(createWorkspaceFile).toHaveBeenCalledWith("nodes/shared/save-user.ts", TEMPLATE)
    expect(onCreated).toHaveBeenCalledWith("./nodes/shared/save-user")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("strips a user-typed .ts extension before submitting", async () => {
    vi.mocked(createWorkspaceFile).mockResolvedValue(undefined)
    const onCreated = vi.fn()
    render(
      <NewNodeDialog
        open
        onOpenChange={vi.fn()}
        onCreated={onCreated}
        defaultFolder="nodes"
        nodesTree={nodesTree}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText(/my-node/i), {
      target: { value: "foo.ts" },
    })
    await act(async () => {
      fireEvent.click(screen.getByText("Create"))
    })
    expect(createWorkspaceFile).toHaveBeenCalledWith("nodes/foo.ts", TEMPLATE)
  })

  it("disables Create when name is empty", () => {
    render(
      <NewNodeDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        defaultFolder="nodes"
        nodesTree={nodesTree}
      />,
    )
    const createBtn = screen.getByText("Create") as HTMLButtonElement
    expect(createBtn.disabled).toBe(true)
  })

  it("shows an inline error if name contains a slash", async () => {
    vi.mocked(createWorkspaceFile).mockResolvedValue(undefined)
    render(
      <NewNodeDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        defaultFolder="nodes"
        nodesTree={nodesTree}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText(/my-node/i), {
      target: { value: "foo/bar" },
    })
    await act(async () => {
      fireEvent.click(screen.getByText("Create"))
    })
    expect(screen.getByText(/cannot contain slashes/i)).toBeInTheDocument()
    expect(createWorkspaceFile).not.toHaveBeenCalled()
  })

  it("surfaces backend errors inline (409 file exists) and does not call onCreated", async () => {
    vi.mocked(createWorkspaceFile).mockRejectedValue(new Error("File already exists"))
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <NewNodeDialog
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
        defaultFolder="nodes"
        nodesTree={nodesTree}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText(/my-node/i), {
      target: { value: "existing" },
    })
    await act(async () => {
      fireEvent.click(screen.getByText("Create"))
    })
    await waitFor(() => {
      expect(screen.getByText("File already exists")).toBeInTheDocument()
    })
    expect(onCreated).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("fetches the nodes tree when nodesTree prop is not provided", async () => {
    vi.mocked(fetchWorkspaceTree).mockResolvedValue({
      workflows: { type: "folder", id: "wf", name: "workflows", children: [] },
      nodes: nodesTree,
    })
    render(<NewNodeDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />)
    await waitFor(() => {
      expect(fetchWorkspaceTree).toHaveBeenCalled()
    })
  })

  it("submits the form when Enter is pressed in the name input", async () => {
    vi.mocked(createWorkspaceFile).mockResolvedValue(undefined)
    const onCreated = vi.fn()
    render(
      <NewNodeDialog
        open
        onOpenChange={vi.fn()}
        onCreated={onCreated}
        defaultFolder="nodes"
        nodesTree={nodesTree}
      />,
    )
    const input = screen.getByPlaceholderText(/my-node/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: "submitted-by-enter" } })
    await act(async () => {
      fireEvent.submit(input.closest("form")!)
    })
    expect(createWorkspaceFile).toHaveBeenCalledWith("nodes/submitted-by-enter.ts", expect.any(String))
    expect(onCreated).toHaveBeenCalledWith("./nodes/submitted-by-enter")
  })

  it("shows .ts as an inline suffix next to the name input", () => {
    render(
      <NewNodeDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        defaultFolder="nodes"
        nodesTree={nodesTree}
      />,
    )
    expect(screen.getByText(".ts")).toBeInTheDocument()
    expect(screen.queryByText(/will be appended/i)).not.toBeInTheDocument()
  })
})
