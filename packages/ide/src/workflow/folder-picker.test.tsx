import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FileFolder } from "@/data/mock-files"
import { FolderPicker } from "./folder-picker"

const tree: FileFolder = {
  type: "folder",
  id: "n-root",
  name: "nodes",
  children: [
    {
      type: "folder",
      id: "n-shared",
      name: "shared",
      children: [
        { type: "file", id: "f1", name: "a.ts", kind: "node", path: "nodes/shared/a.ts" },
      ],
    },
    {
      type: "folder",
      id: "n-users",
      name: "users",
      children: [],
    },
  ],
}

afterEach(() => cleanup())

describe("FolderPicker", () => {
  it("renders the root folder and child folders, not files", () => {
    render(<FolderPicker root={tree} value="nodes" onChange={vi.fn()} />)
    expect(screen.getByText("nodes")).toBeInTheDocument()
    expect(screen.getByText("shared")).toBeInTheDocument()
    expect(screen.getByText("users")).toBeInTheDocument()
    expect(screen.queryByText("a.ts")).not.toBeInTheDocument()
  })

  it("clicking a folder calls onChange with the full relative path", () => {
    const onChange = vi.fn()
    render(<FolderPicker root={tree} value="nodes" onChange={onChange} />)
    fireEvent.click(screen.getByText("shared"))
    expect(onChange).toHaveBeenCalledWith("nodes/shared")
  })

  it("highlights the currently selected folder", () => {
    render(<FolderPicker root={tree} value="nodes/users" onChange={vi.fn()} />)
    const selected = screen.getByText("users").closest("button")!
    expect(selected.className).toMatch(/bg-accent/)
  })

  it("expanding the root reveals child folders only (no files)", () => {
    render(<FolderPicker root={tree} value="nodes" onChange={vi.fn()} />)
    // root is expanded by default — shared+users visible, a.ts not visible
    expect(screen.getByText("shared")).toBeInTheDocument()
    expect(screen.queryByText("a.ts")).not.toBeInTheDocument()
  })
})
