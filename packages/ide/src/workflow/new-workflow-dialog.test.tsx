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
  createWorkspaceFile: vi.fn(),
  fetchWorkspaceTree: vi.fn(),
}))

import { createWorkspaceFile } from "@/lib/api"
import type { FileFolder } from "@/data/mock-files"
import { NewWorkflowDialog } from "./new-workflow-dialog"

const SEED = '{"lorien":1,"nodes":{}}\n'

const workflowsTree: FileFolder = {
  type: "folder",
  id: "wf-root",
  name: "workflows",
  children: [
    { type: "folder", id: "wf-users", name: "users", children: [] },
  ],
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("NewWorkflowDialog", () => {
  it("renders the title and shows the default folder", () => {
    render(
      <NewWorkflowDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        defaultFolder="workflows"
        workflowsTree={workflowsTree}
      />,
    )
    expect(screen.getByText("New workflow")).toBeInTheDocument()
    expect(screen.getByText("workflows")).toBeInTheDocument()
  })

  it("submits <folder>/<name>.workflow with seeded template content", async () => {
    vi.mocked(createWorkspaceFile).mockResolvedValue(undefined)
    const onCreated = vi.fn()
    render(
      <NewWorkflowDialog
        open
        onOpenChange={vi.fn()}
        onCreated={onCreated}
        defaultFolder="workflows/users"
        workflowsTree={workflowsTree}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText(/create/i), {
      target: { value: "list" },
    })
    await act(async () => {
      fireEvent.click(screen.getByText("Create"))
    })
    expect(createWorkspaceFile).toHaveBeenCalledWith("workflows/users/list.workflow", SEED)
    expect(onCreated).toHaveBeenCalledWith("workflows/users/list.workflow")
  })

  it("strips a user-typed .workflow extension", async () => {
    vi.mocked(createWorkspaceFile).mockResolvedValue(undefined)
    render(
      <NewWorkflowDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        defaultFolder="workflows"
        workflowsTree={workflowsTree}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText(/create/i), {
      target: { value: "health.workflow" },
    })
    await act(async () => {
      fireEvent.click(screen.getByText("Create"))
    })
    expect(createWorkspaceFile).toHaveBeenCalledWith("workflows/health.workflow", SEED)
  })

  it("disables Create when name is empty", () => {
    render(
      <NewWorkflowDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        defaultFolder="workflows"
        workflowsTree={workflowsTree}
      />,
    )
    expect((screen.getByText("Create") as HTMLButtonElement).disabled).toBe(true)
  })

  it("surfaces backend errors inline", async () => {
    vi.mocked(createWorkspaceFile).mockRejectedValue(new Error("File already exists"))
    const onCreated = vi.fn()
    render(
      <NewWorkflowDialog
        open
        onOpenChange={vi.fn()}
        onCreated={onCreated}
        defaultFolder="workflows"
        workflowsTree={workflowsTree}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText(/create/i), {
      target: { value: "existing" },
    })
    await act(async () => {
      fireEvent.click(screen.getByText("Create"))
    })
    await waitFor(() => {
      expect(screen.getByText("File already exists")).toBeInTheDocument()
    })
    expect(onCreated).not.toHaveBeenCalled()
  })
})
