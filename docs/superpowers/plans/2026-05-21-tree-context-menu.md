# File-Tree Context Menu & Folder-Aware Create Dialogs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click in the WORKFLOWS or NODES tree to create a new folder, workflow, or node at a resolved target folder, via dialogs that share a single inline folder-picker pattern and auto-append the correct extension.

**Architecture:** A new `POST /api/workspace/folder` endpoint creates empty folders. A reusable `FolderPicker` (inline collapsible tree) drives three dialogs: refactored `NewNodeDialog`, new `NewWorkflowDialog`, new `NewFolderDialog`. A new `TreeContextMenu` reuses the codebase's existing `Popover`-at-cursor pattern from `canvas-context-menu.tsx` and `node-context-menu.tsx`. `FilesPanel` wires `onContextMenu` on rows + section wrappers, resolves the target folder, and opens the appropriate dialog.

**Tech Stack:** React 19, TypeScript, Vitest, @testing-library/react, Hono, shadcn (Popover/Dialog/Input), Zustand (only via existing `useTabsStore`).

**Spec:** `docs/superpowers/specs/2026-05-21-tree-context-menu-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/build/src/commands/ide.ts` | modify | Add `POST /api/workspace/folder` |
| `packages/build/src/commands/ide.test.ts` | modify | Tests for the new endpoint |
| `packages/ide/src/lib/api.ts` | modify | Add `createWorkspaceFolder(path)` client |
| `packages/ide/src/workflow/folder-picker.tsx` | new | Reusable inline collapsible folder tree |
| `packages/ide/src/workflow/folder-picker.test.tsx` | new | Picker tests |
| `packages/ide/src/workflow/new-node-dialog.tsx` | refactor | Folder picker + name input + extension auto-append |
| `packages/ide/src/workflow/new-node-dialog.test.tsx` | rewrite | Match new contract |
| `packages/ide/src/workflow/new-workflow-dialog.tsx` | new | Mirror of node dialog for `.workflow` files |
| `packages/ide/src/workflow/new-workflow-dialog.test.tsx` | new | Workflow-dialog tests |
| `packages/ide/src/workflow/new-folder-dialog.tsx` | new | Folder picker + name input for new folders |
| `packages/ide/src/workflow/new-folder-dialog.test.tsx` | new | Folder-dialog tests |
| `packages/ide/src/panels/tree-context-menu.tsx` | new | Popover-at-cursor menu for files panel |
| `packages/ide/src/panels/tree-context-menu.test.tsx` | new | Menu tests |
| `packages/ide/src/panels/files-panel.tsx` | modify | Right-click handlers, target-folder resolution, dialog mounting |
| `packages/ide/src/panels/files-panel.test.tsx` | modify | Right-click context tests |

---

## Task 1: Backend `POST /api/workspace/folder` endpoint

**Files:**
- Modify: `packages/build/src/commands/ide.ts` (add route after the existing `app.put("/api/workspace/file")` route, around line 186)
- Modify: `packages/build/src/commands/ide.test.ts` (add new describe block at end of file)

- [ ] **Step 1: Write the failing tests**

Append to `packages/build/src/commands/ide.test.ts`:

```ts
describe("POST /api/workspace/folder", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lorien-ide-folder-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  async function makeApp() {
    const { createIdeApp } = await import("./ide.js")
    return createIdeApp(dir)
  }

  it("creates a folder and returns its relative path", async () => {
    const app = await makeApp()
    const res = await app.request("/api/workspace/folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "workflows/admin" }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { path: string }
    expect(json.path).toBe("workflows/admin")
    // statSync would throw if the dir didn't exist
    const { statSync } = await import("node:fs")
    expect(statSync(join(dir, "workflows", "admin")).isDirectory()).toBe(true)
  })

  it("creates nested folders (mkdir -p semantics)", async () => {
    const app = await makeApp()
    const res = await app.request("/api/workspace/folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "nodes/a/b/c" }),
    })
    expect(res.status).toBe(200)
    const { statSync } = await import("node:fs")
    expect(statSync(join(dir, "nodes", "a", "b", "c")).isDirectory()).toBe(true)
  })

  it("is idempotent — creating an existing folder returns 200", async () => {
    const app = await makeApp()
    mkdirSync(join(dir, "workflows", "users"), { recursive: true })
    const res = await app.request("/api/workspace/folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "workflows/users" }),
    })
    expect(res.status).toBe(200)
  })

  it("rejects path traversal with 403", async () => {
    const app = await makeApp()
    const res = await app.request("/api/workspace/folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../escape" }),
    })
    expect(res.status).toBe(403)
  })

  it("returns 400 when path is missing", async () => {
    const app = await makeApp()
    const res = await app.request("/api/workspace/folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-build test 2>&1 | grep -E "(FAIL|PASS|workspace/folder)"
```

Expected: 5 failures — route does not exist yet (404 responses).

- [ ] **Step 3: Add `mkdir` import**

In `packages/build/src/commands/ide.ts`, change the `node:fs/promises` import line (around line 2):

```ts
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
```

- [ ] **Step 4: Add the route**

Insert after the existing `app.put("/api/workspace/file", ...)` route (after its closing `})` around line 186 — before the `// ── Schemas ───` comment):

```ts
app.post("/api/workspace/folder", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    path?: string
  } | null
  if (!body || typeof body.path !== "string" || body.path.length === 0) {
    return c.json({ error: "Body must be { path: string }" }, 400)
  }
  const rawPath = body.path
  const abs = resolve(workspaceRoot, rawPath)
  if (!abs.startsWith(workspaceRoot + sep) && abs !== workspaceRoot) {
    return c.json({ error: "Path traversal denied" }, 403)
  }
  try {
    await mkdir(abs, { recursive: true })
    return c.json({ path: rawPath })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-build test 2>&1 | grep -E "(FAIL|PASS|workspace/folder)"
```

Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/hello/source/cozy-api
git add packages/build/src/commands/ide.ts packages/build/src/commands/ide.test.ts
git commit -m "feat(ide): POST /api/workspace/folder endpoint

mkdir -p semantics inside workspace root, idempotent on existing dir,
traversal-guarded. Used by the new file-tree right-click flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `createWorkspaceFolder` API client

**Files:**
- Modify: `packages/ide/src/lib/api.ts` (append after `createWorkspaceFile`, after line 133)

- [ ] **Step 1: Add the function**

Append to `packages/ide/src/lib/api.ts`:

```ts
/**
 * Creates an empty folder at `path` (mkdir -p semantics). Idempotent.
 */
export async function createWorkspaceFolder(path: string): Promise<void> {
  const res = await fetch("/api/workspace/folder", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
      error?: string
    }
    throw new Error(err.error ?? `Create folder failed: ${res.status}`)
  }
}
```

- [ ] **Step 2: Run typecheck to confirm the function compiles**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/hello/source/cozy-api
git add packages/ide/src/lib/api.ts
git commit -m "feat(ide): createWorkspaceFolder API client

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `FolderPicker` reusable component

**Files:**
- Create: `packages/ide/src/workflow/folder-picker.tsx`
- Create: `packages/ide/src/workflow/folder-picker.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/ide/src/workflow/folder-picker.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test folder-picker 2>&1 | grep -E "(FAIL|PASS|Cannot find)"
```

Expected: tests fail because the module doesn't exist yet.

- [ ] **Step 3: Implement `FolderPicker`**

Create `packages/ide/src/workflow/folder-picker.tsx`. The component threads the full relative path through recursion so each row knows its own absolute path (the root receives its `name`, children get `${parent}/${name}`):

```tsx
import { ChevronDown, ChevronRight, Folder as FolderIcon, FolderOpen } from "lucide-react"
import { useState } from "react"
import type { FileFolder, FileNode } from "@/data/mock-files"
import { cn } from "@/lib/utils"

interface Props {
  root: FileFolder
  value: string
  onChange: (path: string) => void
}

export function FolderPicker({ root, value, onChange }: Props) {
  return (
    <div
      className="max-h-48 overflow-auto rounded border border-border bg-muted/30 p-1"
      data-testid="folder-picker"
    >
      <FolderRow
        node={root}
        path={root.name}
        depth={0}
        value={value}
        onChange={onChange}
        forceOpen
      />
    </div>
  )
}

function FolderRow({
  node,
  path,
  depth,
  value,
  onChange,
  forceOpen = false,
}: {
  node: Extract<FileNode, { type: "folder" }>
  path: string
  depth: number
  value: string
  onChange: (path: string) => void
  forceOpen?: boolean
}) {
  const [open, setOpen] = useState(forceOpen)
  const selected = path === value
  const childFolders = node.children.filter(
    (c): c is Extract<FileNode, { type: "folder" }> => c.type === "folder",
  )

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          onChange(path)
        }}
        className={cn(
          "flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
          selected && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: depth * 8 + 4 }}
      >
        {childFolders.length > 0 ? (
          open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )
        ) : (
          <span className="inline-block h-3 w-3" />
        )}
        {open ? (
          <FolderOpen className="h-3.5 w-3.5" />
        ) : (
          <FolderIcon className="h-3.5 w-3.5" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <div>
          {childFolders.map((child) => (
            <FolderRow
              key={child.id}
              node={child}
              path={`${path}/${child.name}`}
              depth={depth + 1}
              value={value}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test folder-picker 2>&1 | grep -E "(FAIL|PASS|Tests)"
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/hello/source/cozy-api
git add packages/ide/src/workflow/folder-picker.tsx packages/ide/src/workflow/folder-picker.test.tsx
git commit -m "feat(ide): FolderPicker reusable inline tree component

Renders folder rows only (no files) for the upcoming New Folder /
New Node / New Workflow dialog flows. Threads full relative path
through recursion so onChange receives e.g. \"nodes/shared\".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Refactor `NewNodeDialog` to folder-picker + name input

**Files:**
- Modify: `packages/ide/src/workflow/new-node-dialog.tsx` (full rewrite)
- Rewrite: `packages/ide/src/workflow/new-node-dialog.test.tsx`
- Modify: `packages/ide/src/workflow/workflow-editor.tsx` (update call site — props change)

- [ ] **Step 1: Replace the test file with the new contract**

Replace the entire contents of `packages/ide/src/workflow/new-node-dialog.test.tsx`:

```tsx
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
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test new-node-dialog 2>&1 | grep -E "(FAIL|PASS|Tests)"
```

Expected: tests fail — old `NewNodeDialog` doesn't have the new contract.

- [ ] **Step 3: Replace `new-node-dialog.tsx`**

Replace the entire contents of `packages/ide/src/workflow/new-node-dialog.tsx`:

```tsx
import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { FileFolder } from "@/data/mock-files"
import { createWorkspaceFile, fetchWorkspaceTree } from "@/lib/api"
import { FolderPicker } from "./folder-picker"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the relative `uses` path after the file is created. */
  onCreated: (uses: string) => void
  /** Folder to preselect (relative path, e.g. "nodes/shared"). Defaults to "nodes". */
  defaultFolder?: string
  /** Nodes tree for the picker. If omitted, the dialog fetches it on open. */
  nodesTree?: FileFolder
}

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

export function NewNodeDialog({
  open,
  onOpenChange,
  onCreated,
  defaultFolder = "nodes",
  nodesTree,
}: Props) {
  const [folder, setFolder] = useState(defaultFolder)
  const [name, setName] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tree, setTree] = useState<FileFolder | null>(nodesTree ?? null)

  // Reset state when the dialog opens (so a second invocation doesn't show stale name)
  useEffect(() => {
    if (open) {
      setFolder(defaultFolder)
      setName("")
      setPickerOpen(false)
      setError(null)
    }
  }, [open, defaultFolder])

  // Fetch the nodes tree if not provided
  useEffect(() => {
    if (!open || nodesTree || tree) return
    fetchWorkspaceTree()
      .then((t) => setTree(t.nodes))
      .catch(() => {
        // leave tree=null; picker won't open, but user can still type a name
      })
  }, [open, nodesTree, tree])

  async function handleCreate() {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed.includes("/")) {
      setError("Name cannot contain slashes")
      return
    }
    const bare = trimmed.replace(/\.ts$/, "")
    const fullPath = `${folder}/${bare}.ts`
    try {
      await createWorkspaceFile(fullPath, TEMPLATE)
      const uses = `./${fullPath.replace(/\.ts$/, "")}`
      onOpenChange(false)
      onCreated(uses)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const activeTree = nodesTree ?? tree

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New custom node</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Folder</span>
              <button
                type="button"
                onClick={() => setPickerOpen((p) => !p)}
                className="rounded px-2 py-0.5 hover:bg-accent"
                disabled={!activeTree}
              >
                Change
              </button>
            </div>
            <div className="rounded border border-border bg-muted/30 px-2 py-1 text-sm">
              {folder}
            </div>
            {pickerOpen && activeTree && (
              <FolderPicker
                root={activeTree}
                value={folder}
                onChange={(p) => {
                  setFolder(p)
                  setPickerOpen(false)
                }}
              />
            )}
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Name</div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-node"
              autoFocus
            />
            <div className="text-xs text-muted-foreground">.ts will be appended</div>
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded px-3 py-1.5 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={name.trim().length === 0}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test new-node-dialog 2>&1 | grep -E "(FAIL|PASS|Tests)"
```

Expected: 8 passing.

- [ ] **Step 5: Verify existing workflow-editor call site still typechecks**

The call site at `packages/ide/src/workflow/workflow-editor.tsx:865` passes only `open`, `onOpenChange`, `onCreated`. With the new optional props (`defaultFolder`, `nodesTree`), the existing call remains valid — the dialog will fall back to the default folder `"nodes"` and fetch the tree itself on open.

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 6: Run the full ide test suite to catch regressions in workflow-editor tests**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test 2>&1 | tail -20
```

Expected: all tests passing (no regressions).

- [ ] **Step 7: Commit**

```bash
cd C:/Users/hello/source/cozy-api
git add packages/ide/src/workflow/new-node-dialog.tsx packages/ide/src/workflow/new-node-dialog.test.tsx
git commit -m "refactor(ide): folder-picker + name input in NewNodeDialog

Replaces the free-form path text input with a folder field
(defaulting to passed-in folder, otherwise \"nodes\"), an inline
\"Change\" toggle that opens the FolderPicker, and a name input
that auto-appends .ts. Existing workflow-editor call site keeps
working because the new props are optional.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `NewWorkflowDialog`

**Files:**
- Create: `packages/ide/src/workflow/new-workflow-dialog.tsx`
- Create: `packages/ide/src/workflow/new-workflow-dialog.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `packages/ide/src/workflow/new-workflow-dialog.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run to verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test new-workflow-dialog 2>&1 | grep -E "(FAIL|PASS|Cannot find)"
```

Expected: module not found.

- [ ] **Step 3: Implement the dialog**

Create `packages/ide/src/workflow/new-workflow-dialog.tsx`:

```tsx
import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { FileFolder } from "@/data/mock-files"
import { createWorkspaceFile, fetchWorkspaceTree } from "@/lib/api"
import { FolderPicker } from "./folder-picker"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new workflow's relative path (e.g. "workflows/users/list.workflow"). */
  onCreated: (path: string) => void
  /** Defaults to "workflows". */
  defaultFolder?: string
  /** If omitted, the dialog fetches the tree on open. */
  workflowsTree?: FileFolder
}

const WORKFLOW_SEED = '{"lorien":1,"nodes":{}}\n'

export function NewWorkflowDialog({
  open,
  onOpenChange,
  onCreated,
  defaultFolder = "workflows",
  workflowsTree,
}: Props) {
  const [folder, setFolder] = useState(defaultFolder)
  const [name, setName] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tree, setTree] = useState<FileFolder | null>(workflowsTree ?? null)

  useEffect(() => {
    if (open) {
      setFolder(defaultFolder)
      setName("")
      setPickerOpen(false)
      setError(null)
    }
  }, [open, defaultFolder])

  useEffect(() => {
    if (!open || workflowsTree || tree) return
    fetchWorkspaceTree()
      .then((t) => setTree(t.workflows))
      .catch(() => {})
  }, [open, workflowsTree, tree])

  async function handleCreate() {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed.includes("/")) {
      setError("Name cannot contain slashes")
      return
    }
    const bare = trimmed.replace(/\.workflow$/, "")
    const fullPath = `${folder}/${bare}.workflow`
    try {
      await createWorkspaceFile(fullPath, WORKFLOW_SEED)
      onOpenChange(false)
      onCreated(fullPath)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const activeTree = workflowsTree ?? tree

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Folder</span>
              <button
                type="button"
                onClick={() => setPickerOpen((p) => !p)}
                className="rounded px-2 py-0.5 hover:bg-accent"
                disabled={!activeTree}
              >
                Change
              </button>
            </div>
            <div className="rounded border border-border bg-muted/30 px-2 py-1 text-sm">
              {folder}
            </div>
            {pickerOpen && activeTree && (
              <FolderPicker
                root={activeTree}
                value={folder}
                onChange={(p) => {
                  setFolder(p)
                  setPickerOpen(false)
                }}
              />
            )}
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Name</div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="create"
              autoFocus
            />
            <div className="text-xs text-muted-foreground">.workflow will be appended</div>
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded px-3 py-1.5 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={name.trim().length === 0}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test new-workflow-dialog 2>&1 | grep -E "(FAIL|PASS|Tests)"
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/hello/source/cozy-api
git add packages/ide/src/workflow/new-workflow-dialog.tsx packages/ide/src/workflow/new-workflow-dialog.test.tsx
git commit -m "feat(ide): NewWorkflowDialog

Mirror of NewNodeDialog for .workflow files. Seeds the new file
with an empty workflow body ({\"lorien\":1,\"nodes\":{}}).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `NewFolderDialog`

**Files:**
- Create: `packages/ide/src/workflow/new-folder-dialog.tsx`
- Create: `packages/ide/src/workflow/new-folder-dialog.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `packages/ide/src/workflow/new-folder-dialog.test.tsx`:

```tsx
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
})
```

- [ ] **Step 2: Run to verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test new-folder-dialog 2>&1 | grep -E "(FAIL|PASS|Cannot find)"
```

Expected: module not found.

- [ ] **Step 3: Implement the dialog**

Create `packages/ide/src/workflow/new-folder-dialog.tsx`:

```tsx
import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { FileFolder } from "@/data/mock-files"
import { createWorkspaceFolder } from "@/lib/api"
import { FolderPicker } from "./folder-picker"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new folder's relative path (e.g. "workflows/admin"). */
  onCreated: (path: string) => void
  /** Parent folder to default to. */
  defaultFolder: string
  /** Tree root for the picker. */
  root: FileFolder
}

export function NewFolderDialog({
  open,
  onOpenChange,
  onCreated,
  defaultFolder,
  root,
}: Props) {
  const [parent, setParent] = useState(defaultFolder)
  const [name, setName] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setParent(defaultFolder)
      setName("")
      setPickerOpen(false)
      setError(null)
    }
  }, [open, defaultFolder])

  async function handleCreate() {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed.includes("/")) {
      setError("Name cannot contain slashes")
      return
    }
    const fullPath = `${parent}/${trimmed}`
    try {
      await createWorkspaceFolder(fullPath)
      onOpenChange(false)
      onCreated(fullPath)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Inside</span>
              <button
                type="button"
                onClick={() => setPickerOpen((p) => !p)}
                className="rounded px-2 py-0.5 hover:bg-accent"
              >
                Change
              </button>
            </div>
            <div className="rounded border border-border bg-muted/30 px-2 py-1 text-sm">
              {parent}
            </div>
            {pickerOpen && (
              <FolderPicker
                root={root}
                value={parent}
                onChange={(p) => {
                  setParent(p)
                  setPickerOpen(false)
                }}
              />
            )}
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Name</div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="admin"
              autoFocus
            />
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded px-3 py-1.5 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={name.trim().length === 0}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test new-folder-dialog 2>&1 | grep -E "(FAIL|PASS|Tests)"
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/hello/source/cozy-api
git add packages/ide/src/workflow/new-folder-dialog.tsx packages/ide/src/workflow/new-folder-dialog.test.tsx
git commit -m "feat(ide): NewFolderDialog

Calls createWorkspaceFolder with <parent>/<name>. Same shape as
NewNodeDialog/NewWorkflowDialog but no extension and uses the
mkdir endpoint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `TreeContextMenu`

**Files:**
- Create: `packages/ide/src/panels/tree-context-menu.tsx`
- Create: `packages/ide/src/panels/tree-context-menu.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `packages/ide/src/panels/tree-context-menu.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run to verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test tree-context-menu 2>&1 | grep -E "(FAIL|PASS|Cannot find)"
```

Expected: module not found.

- [ ] **Step 3: Implement `TreeContextMenu`**

Create `packages/ide/src/panels/tree-context-menu.tsx`:

```tsx
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  x: number
  y: number
  tree: "workflows" | "nodes"
  onNewFolder: () => void
  onNewItem: () => void
}

/**
 * Right-click menu for the files panel. Mirrors the Popover + fixed 1x1
 * trigger pattern used by canvas-context-menu and node-context-menu.
 */
export function TreeContextMenu({
  open,
  onOpenChange,
  x,
  y,
  tree,
  onNewFolder,
  onNewItem,
}: Props) {
  const itemLabel = tree === "workflows" ? "New workflow…" : "New node…"
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <div
          style={{ position: "fixed", left: x, top: y, width: 1, height: 1, pointerEvents: "none" }}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <MenuItem
          onClick={() => {
            onOpenChange(false)
            onNewFolder()
          }}
        >
          New folder…
        </MenuItem>
        <MenuItem
          onClick={() => {
            onOpenChange(false)
            onNewItem()
          }}
        >
          {itemLabel}
        </MenuItem>
      </PopoverContent>
    </Popover>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test tree-context-menu 2>&1 | grep -E "(FAIL|PASS|Tests)"
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/hello/source/cozy-api
git add packages/ide/src/panels/tree-context-menu.tsx packages/ide/src/panels/tree-context-menu.test.tsx
git commit -m "feat(ide): TreeContextMenu

Right-click menu for the files panel using the same Popover +
fixed 1x1 trigger pattern as canvas-context-menu and
node-context-menu. Items vary by tree (workflows vs nodes).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire `FilesPanel`

**Files:**
- Modify: `packages/ide/src/panels/files-panel.tsx`
- Modify: `packages/ide/src/panels/files-panel.test.tsx`

- [ ] **Step 1: Write failing tests**

Replace the existing `describe("FilesPanel", () => { ... })` block in `packages/ide/src/panels/files-panel.test.tsx` with the expanded version below (keeping the existing tests, adding new ones):

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useTabsStore } from "@/store/tabs"
import { FilesPanel } from "./files-panel.js"

// Popover uses portals — render inline so we can assert on its content
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="popover">{children}</div> : null,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Dialog uses portals too
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

beforeEach(() => {
  localStorage.clear()
  useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch not available in tests")))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("FilesPanel", () => {
  it("renders the WORKFLOWS and NODES section headers (fallback mode)", async () => {
    render(<FilesPanel />)
    await waitFor(() => {
      expect(screen.getByText("WORKFLOWS")).toBeInTheDocument()
      expect(screen.getByText("NODES")).toBeInTheDocument()
    })
  })

  it("clicking a file leaf opens it as a tab", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("NODES")).toBeInTheDocument())
    fireEvent.click(screen.getByText("shared"))
    const link = screen.getByText("parseBody.ts")
    fireEvent.click(link)
    expect(useTabsStore.getState().tabs).toHaveLength(1)
    expect(useTabsStore.getState().tabs[0]?.id).toBe("nodes/shared/parseBody.ts")
    expect(useTabsStore.getState().activeCodeId).toBe("nodes/shared/parseBody.ts")
  })

  it("dragging a .ts node leaf sets the correct dataTransfer payload", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("NODES")).toBeInTheDocument())
    fireEvent.click(screen.getByText("shared"))
    const leaf = screen.getByText("parseBody.ts").closest("button")!
    const dataTransferMock = { setData: vi.fn(), effectAllowed: "" as string }
    fireEvent.dragStart(leaf, { dataTransfer: dataTransferMock })
    expect(dataTransferMock.setData).toHaveBeenCalledWith(
      "application/lorien-node",
      "./nodes/shared/parseBody",
    )
  })
})

describe("FilesPanel — right-click context menu (fallback disabled)", () => {
  it("right-clicking a folder while in fallback mode does not open the menu", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("NODES")).toBeInTheDocument())
    const folder = screen.getByText("shared").closest("button")!
    fireEvent.contextMenu(folder)
    // In fallback mode we don't open the menu — creating against mock data would
    // silently fail to persist.
    expect(screen.queryByTestId("popover")).not.toBeInTheDocument()
  })
})

describe("FilesPanel — right-click context menu (ready)", () => {
  beforeEach(() => {
    // Override the global fetch stub so the workspace tree resolves successfully.
    const tree = {
      workflows: {
        type: "folder",
        id: "wf",
        name: "workflows",
        children: [
          {
            type: "folder",
            id: "wf-users",
            name: "users",
            children: [
              {
                type: "file",
                id: "wf-users-create",
                name: "create.workflow",
                kind: "workflow",
                path: "workflows/users/create.workflow",
              },
            ],
          },
        ],
      },
      nodes: {
        type: "folder",
        id: "n",
        name: "nodes",
        children: [],
      },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.endsWith("/api/workspace/tree")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(tree),
          })
        }
        return Promise.reject(new Error("unexpected fetch"))
      }),
    )
  })

  it("right-clicking a folder opens the workflows context menu", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("users")).toBeInTheDocument())
    const folder = screen.getByText("users").closest("button")!
    fireEvent.contextMenu(folder)
    await waitFor(() => {
      expect(screen.getByText(/New folder/)).toBeInTheDocument()
      expect(screen.getByText(/New workflow/)).toBeInTheDocument()
    })
  })

  it("right-clicking a file uses the file's parent folder as target", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("create.workflow")).toBeInTheDocument())
    fireEvent.contextMenu(screen.getByText("create.workflow").closest("button")!)
    fireEvent.click(screen.getByText(/New workflow/))
    // Dialog now open with defaultFolder = "workflows/users"
    await waitFor(() => {
      expect(screen.getByText("workflows/users")).toBeInTheDocument()
    })
  })

  it("right-clicking empty space in the WORKFLOWS section uses workflows root", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("WORKFLOWS")).toBeInTheDocument())
    const section = screen.getByText("WORKFLOWS").parentElement!
    fireEvent.contextMenu(section)
    fireEvent.click(screen.getByText(/New workflow/))
    await waitFor(() => {
      expect(screen.getByText("workflows")).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run to verify FAIL on the new tests**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test files-panel 2>&1 | grep -E "(FAIL|PASS|context menu|right-click)"
```

Expected: new tests fail (popover does not appear).

- [ ] **Step 3: Update `FilesPanel`**

Replace the contents of `packages/ide/src/panels/files-panel.tsx`:

```tsx
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  WifiOff,
} from "lucide-react"
import { type MouseEvent as ReactMouseEvent, useEffect, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { type FileFolder, type FileNode, mockNodes, mockWorkflows } from "@/data/mock-files"
import { fetchWorkspaceTree } from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"
import { openCodeFile } from "@/lib/open-code-file"
import { cn } from "@/lib/utils"
import { useDockviewApi } from "@/store/dockview-api"
import { useTabsStore } from "@/store/tabs"
import { NewFolderDialog } from "@/workflow/new-folder-dialog"
import { NewNodeDialog } from "@/workflow/new-node-dialog"
import { NewWorkflowDialog } from "@/workflow/new-workflow-dialog"
import { TreeContextMenu } from "./tree-context-menu"

type LoadState = "loading" | "ready" | "fallback"
type TreeKind = "workflows" | "nodes"

interface MenuState {
  open: boolean
  x: number
  y: number
  tree: TreeKind
  folder: string
}

type DialogKind = "none" | "new-folder" | "new-workflow" | "new-node"

export function FilesPanel() {
  const [workflows, setWorkflows] = useState<FileFolder>(mockWorkflows)
  const [nodes, setNodes] = useState<FileFolder>(mockNodes)
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [menu, setMenu] = useState<MenuState>({
    open: false,
    x: 0,
    y: 0,
    tree: "workflows",
    folder: "workflows",
  })
  const [dialog, setDialog] = useState<DialogKind>("none")

  const refreshTree = () => {
    fetchWorkspaceTree()
      .then((tree) => {
        setWorkflows(tree.workflows)
        setNodes(tree.nodes)
        setLoadState("ready")
      })
      .catch(() => {
        setLoadState("fallback")
      })
  }

  useEffect(() => {
    let cancelled = false
    fetchWorkspaceTree()
      .then((tree) => {
        if (cancelled) return
        setWorkflows(tree.workflows)
        setNodes(tree.nodes)
        setLoadState("ready")
      })
      .catch(() => {
        if (cancelled) return
        setLoadState("fallback")
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return subscribeToFileEvents((e) => {
      if (e.type === "add" || e.type === "unlink") {
        refreshTree()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openMenu = (e: ReactMouseEvent, tree: TreeKind, folder: string) => {
    if (loadState !== "ready") return
    e.preventDefault()
    e.stopPropagation()
    setMenu({ open: true, x: e.clientX, y: e.clientY, tree, folder })
  }

  const itemTree = menu.tree === "workflows" ? workflows : nodes

  return (
    <div className="flex h-full flex-col">
      {loadState === "fallback" && (
        <div className="flex items-center gap-1.5 border-b bg-amber-500/10 px-2 py-1 text-[10px] text-amber-600 dark:text-amber-400">
          <WifiOff className="h-3 w-3 shrink-0" />
          <span>Backend not available — showing demo data</span>
        </div>
      )}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {loadState === "loading" ? (
            <div className="space-y-1 px-1 py-2">
              <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <>
              <Section
                title="WORKFLOWS"
                treeKind="workflows"
                tree={workflows}
                onContextMenu={openMenu}
              />
              <Section title="NODES" treeKind="nodes" tree={nodes} onContextMenu={openMenu} />
            </>
          )}
        </div>
      </ScrollArea>
      <TreeContextMenu
        open={menu.open}
        onOpenChange={(o) => setMenu((m) => ({ ...m, open: o }))}
        x={menu.x}
        y={menu.y}
        tree={menu.tree}
        onNewFolder={() => setDialog("new-folder")}
        onNewItem={() => setDialog(menu.tree === "workflows" ? "new-workflow" : "new-node")}
      />
      <NewFolderDialog
        open={dialog === "new-folder"}
        onOpenChange={(o) => !o && setDialog("none")}
        onCreated={() => refreshTree()}
        defaultFolder={menu.folder}
        root={itemTree}
      />
      <NewWorkflowDialog
        open={dialog === "new-workflow"}
        onOpenChange={(o) => !o && setDialog("none")}
        onCreated={(path) => {
          // refreshTree() is triggered by SSE add event; also open the new file
          const title = path.split("/").pop() ?? path
          useTabsStore.getState().openTab({ id: path, title, kind: "workflow", path })
          useDockviewApi.getState().api?.getPanel("workflow")?.api.setActive()
        }}
        defaultFolder={menu.folder}
        workflowsTree={workflows}
      />
      <NewNodeDialog
        open={dialog === "new-node"}
        onOpenChange={(o) => !o && setDialog("none")}
        onCreated={(uses) => {
          // uses is "./nodes/foo" — convert back to file path for the tab
          const path = `${uses.replace(/^\.\//, "")}.ts`
          openCodeFile(path)
        }}
        defaultFolder={menu.folder}
        nodesTree={nodes}
      />
    </div>
  )
}

function Section({
  title,
  treeKind,
  tree,
  onContextMenu,
}: {
  title: string
  treeKind: TreeKind
  tree: FileNode
  onContextMenu: (e: ReactMouseEvent, tree: TreeKind, folder: string) => void
}) {
  const rootPath = tree.type === "folder" ? tree.name : treeKind
  return (
    <div
      className="mb-3"
      onContextMenu={(e) => onContextMenu(e, treeKind, rootPath)}
    >
      <div className="px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <TreeNode
        node={tree}
        depth={0}
        path={rootPath}
        treeKind={treeKind}
        onContextMenu={onContextMenu}
        forceOpen
      />
    </div>
  )
}

function TreeNode({
  node,
  depth,
  path,
  treeKind,
  onContextMenu,
  forceOpen = false,
}: {
  node: FileNode
  depth: number
  path: string
  treeKind: TreeKind
  onContextMenu: (e: ReactMouseEvent, tree: TreeKind, folder: string) => void
  forceOpen?: boolean
}) {
  if (node.type === "folder") {
    return (
      <Folder_
        node={node}
        depth={depth}
        path={path}
        treeKind={treeKind}
        onContextMenu={onContextMenu}
        forceOpen={forceOpen}
      />
    )
  }
  return (
    <Leaf
      node={node}
      depth={depth}
      parentPath={path}
      treeKind={treeKind}
      onContextMenu={onContextMenu}
    />
  )
}

function Folder_({
  node,
  depth,
  path,
  treeKind,
  onContextMenu,
  forceOpen,
}: {
  node: Extract<FileNode, { type: "folder" }>
  depth: number
  path: string
  treeKind: TreeKind
  onContextMenu: (e: ReactMouseEvent, tree: TreeKind, folder: string) => void
  forceOpen: boolean
}) {
  const [open, setOpen] = useState(forceOpen)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => onContextMenu(e, treeKind, path)}
        className={cn(
          "flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
        )}
        style={{ paddingLeft: depth * 8 + 4 }}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {open ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              path={child.type === "folder" ? `${path}/${child.name}` : path}
              treeKind={treeKind}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Leaf({
  node,
  depth,
  parentPath,
  treeKind,
  onContextMenu,
}: {
  node: Extract<FileNode, { type: "file" }>
  depth: number
  parentPath: string
  treeKind: TreeKind
  onContextMenu: (e: ReactMouseEvent, tree: TreeKind, folder: string) => void
}) {
  const openTab = useTabsStore((s) => s.openTab)
  const activeWorkflowId = useTabsStore((s) => s.activeWorkflowId)
  const activeCodeId = useTabsStore((s) => s.activeCodeId)
  const nodeTabId = node.kind === "node" ? (node.path ?? node.id) : node.id
  const isActive =
    node.kind === "workflow" ? activeWorkflowId === node.id : activeCodeId === nodeTabId

  const Icon = node.kind === "workflow" ? FileText : FileCode

  return (
    <button
      type="button"
      draggable={node.kind === "node" && node.path?.endsWith(".ts")}
      onDragStart={(e) => {
        if (node.path && node.path.endsWith(".ts")) {
          const uses = `./${node.path.replace(/\.ts$/, "")}`
          e.dataTransfer.setData("application/lorien-node", uses)
          e.dataTransfer.effectAllowed = "copy"
        }
      }}
      onContextMenu={(e) => {
        // Target = the file's parent folder. parentPath was passed by TreeNode
        // (the parent folder's full path); for the workflows/nodes root files,
        // it falls back to the tree's root name.
        const folder = node.path
          ? node.path.split("/").slice(0, -1).join("/") || parentPath
          : parentPath
        onContextMenu(e, treeKind, folder)
      }}
      onClick={() => {
        if (node.kind === "node" && node.path) {
          openCodeFile(node.path)
          return
        }
        const tab: Parameters<typeof openTab>[0] = {
          id: node.id,
          title: node.name,
          kind: node.kind,
        }
        if (node.path !== undefined) tab.path = node.path
        openTab(tab)

        const api = useDockviewApi.getState().api
        if (api) {
          const panelId = node.kind === "workflow" ? "workflow" : "code"
          const panel = api.getPanel(panelId)
          if (panel) panel.api.setActive()
        }
      }}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
        isActive && "bg-accent text-accent-foreground",
      )}
      style={{ paddingLeft: depth * 8 + 16 }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test files-panel 2>&1 | grep -E "(FAIL|PASS|Tests)"
```

Expected: all passing (original 3 + new 4).

- [ ] **Step 5: Run typecheck and full test suite**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: no errors.

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test 2>&1 | tail -20
```

Expected: all tests passing.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/hello/source/cozy-api
git add packages/ide/src/panels/files-panel.tsx packages/ide/src/panels/files-panel.test.tsx
git commit -m "feat(ide): right-click file tree to create folders, workflows, nodes

FilesPanel attaches onContextMenu to folder rows, file rows, and the
section wrappers; resolves the target folder (folder=itself,
file=parent, section=root); opens TreeContextMenu; the chosen action
opens the matching create dialog with the resolved folder preselected.

Menu is disabled when loadState !== \"ready\" so we don't pretend to
persist against mock data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Full verification

- [ ] **Step 1: Full build**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r build 2>&1 | tail -30
```

Expected: no errors.

- [ ] **Step 2: Full typecheck**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r typecheck 2>&1 | tail -30
```

Expected: no errors.

- [ ] **Step 3: Full test run**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test 2>&1 | tail -30
```

Expected: all tests passing.

- [ ] **Step 4: Manual smoke (must run dev server)**

In a terminal, start the IDE dev server (Vite + the build/IDE backend):

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide dev
```

Manually verify in the browser:
1. Right-click a folder in WORKFLOWS → menu shows `New folder…` and `New workflow…`.
2. Right-click a `.workflow` file → menu shows the same items, but the target is the file's parent.
3. Right-click empty space in WORKFLOWS → target is `workflows` root.
4. Same verifications for NODES tree (menu shows `New node…`).
5. Open `New workflow` → folder field shows the resolved target; Change toggles the picker; name input + `.workflow` hint; Create creates the file and opens it as a tab.
6. Open `New node` → same flow with `.ts` hint; created file opens in code panel.
7. Open `New folder` → name input; Create creates the folder and the tree refreshes.

---

## Spec Coverage Self-Review

- **Right-click resolution rule (folder / file / empty space)** → Task 8 (FilesPanel `openMenu` + Section/Folder_/Leaf `onContextMenu`).
- **Menu scoped per tree (workflows vs nodes)** → Task 7 (`TreeContextMenu` `tree` prop).
- **Menu disabled in fallback** → Task 8 (`openMenu` guards on `loadState === "ready"`).
- **Folder picker inline collapsible** → Task 3 (`FolderPicker`), used by Tasks 4/5/6.
- **Folder picker scoped to relevant root** → Tasks 4/5/6 pass `workflowsTree` / `nodesTree` / `root` respectively.
- **Name auto-strips extension** → Tasks 4 (`replace(/\.ts$/, "")`), 5 (`replace(/\.workflow$/, "")`).
- **Validation: empty + slash** → Tasks 4/5/6 (`disabled` on empty, error on slash).
- **409 surfaced inline** → Tasks 4/5/6 catch block.
- **Fallback state disables menu** → Task 8 (`openMenu` guard).
- **Post-create refresh: files via SSE, folders via manual `refreshTree()`** → Task 8 (`NewFolderDialog onCreated` calls `refreshTree()`; file dialogs rely on SSE).
- **New workflow opens as a tab + focuses workflow panel** → Task 8 (`NewWorkflowDialog onCreated`).
- **New node opens in code panel** → Task 8 (`NewNodeDialog onCreated` → `openCodeFile`).
- **Existing workflow-editor canvas New Custom Node flow keeps working** → Task 4 Step 5 (props are optional; default folder = `nodes`).
- **Backend endpoint: traversal-guarded, idempotent** → Task 1.
