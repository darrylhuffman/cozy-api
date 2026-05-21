import React from "react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

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
  createWorkspaceFolder: vi.fn(),
}))

import { createWorkspaceFolder } from "@/lib/api"
import type { FileFolder } from "@/data/mock-files"
import { NewFolderDialog } from "./new-folder-dialog"

const tree: FileFolder = {
  type: "folder",
  id: "wf",
  name: "workflows",
  children: [{ type: "folder", id: "u", name: "users", children: [] }],
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("NewFolderDialog", () => {
  it("shows the parent folder and an empty name input", () => {
    render(
      <NewFolderDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        defaultFolder="workflows/users"
        root={tree}
      />,
    )
    expect(screen.getByText("New folder")).toBeInTheDocument()
    expect(screen.getByText("workflows/users")).toBeInTheDocument()
  })

  it("calls createWorkspaceFolder with <parent>/<name> on submit", async () => {
    vi.mocked(createWorkspaceFolder).mockResolvedValue(undefined)
    const onCreated = vi.fn()
    render(
      <NewFolderDialog
        open
        onOpenChange={vi.fn()}
        onCreated={onCreated}
        defaultFolder="workflows"
        root={tree}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText(/admin/i), { target: { value: "admin" } })
    await act(async () => {
      fireEvent.click(screen.getByText("Create"))
    })
    expect(createWorkspaceFolder).toHaveBeenCalledWith("workflows/admin")
    expect(onCreated).toHaveBeenCalledWith("workflows/admin")
  })

  it("rejects names containing slashes", async () => {
    render(
      <NewFolderDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        defaultFolder="workflows"
        root={tree}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText(/admin/i), { target: { value: "a/b" } })
    await act(async () => {
      fireEvent.click(screen.getByText("Create"))
    })
    expect(screen.getByText(/cannot contain slashes/i)).toBeInTheDocument()
    expect(createWorkspaceFolder).not.toHaveBeenCalled()
  })

  it("disables Create when name is empty", () => {
    render(
      <NewFolderDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        defaultFolder="workflows"
        root={tree}
      />,
    )
    expect((screen.getByText("Create") as HTMLButtonElement).disabled).toBe(true)
  })

  it("surfaces backend errors inline", async () => {
    vi.mocked(createWorkspaceFolder).mockRejectedValue(new Error("disk full"))
    const onCreated = vi.fn()
    render(
      <NewFolderDialog
        open
        onOpenChange={vi.fn()}
        onCreated={onCreated}
        defaultFolder="workflows"
        root={tree}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText(/admin/i), { target: { value: "x" } })
    await act(async () => {
      fireEvent.click(screen.getByText("Create"))
    })
    await waitFor(() => {
      expect(screen.getByText("disk full")).toBeInTheDocument()
    })
    expect(onCreated).not.toHaveBeenCalled()
  })

  it("submits the form when Enter is pressed in the name input", async () => {
    vi.mocked(createWorkspaceFolder).mockResolvedValue(undefined)
    const onCreated = vi.fn()
    render(
      <NewFolderDialog
        open
        onOpenChange={vi.fn()}
        onCreated={onCreated}
        defaultFolder="workflows"
        root={tree}
      />,
    )
    const input = screen.getByPlaceholderText(/admin/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: "submitted-by-enter" } })
    await act(async () => {
      fireEvent.submit(input.closest("form")!)
    })
    expect(createWorkspaceFolder).toHaveBeenCalledWith("workflows/submitted-by-enter")
    expect(onCreated).toHaveBeenCalledWith("workflows/submitted-by-enter")
  })
})
