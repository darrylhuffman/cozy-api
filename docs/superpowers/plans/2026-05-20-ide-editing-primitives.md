# IDE Editing Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the missing "build a workflow from scratch" primitives in the lorien IDE: add nodes via three affordances, delete nodes/edges, disconnect by drag-to-empty, and populate the Inspector panel.

**Architecture:** A new Zustand selection store glues the workflow editor and the Inspector. A reusable `<AddNodePalette>` component powers three triggers (Ctrl+K Dialog, right-click Popover, drag-from-sidebar). Editing is funneled through a small set of pure helpers (`addNode`, `deleteNode`, `deleteEdgeMappings`) that mutate the workflow JSON immutably; React Flow callbacks call those helpers and mark the tab dirty.

**Tech Stack:** React 19, TypeScript, Zustand (already in repo), React Flow (`@xyflow/react`), shadcn/ui (already includes Dialog/Popover via cmdk), pnpm monorepo, Vitest + React Testing Library.

**Working dir:** `C:\Users\hello\source\cozy-api`. Branch: `feat/ide-editing` (already current). Most recent commit before plan: `2cab1bc` (the spec).

**Reading the codebase first:** Each implementer subagent should read the spec at `docs/superpowers/specs/2026-05-20-ide-editing-primitives-design.md` plus the listed "Files to read" in their task. The existing patterns (Zustand stores in `packages/ide/src/store/`, panels in `packages/ide/src/panels/`, schemas endpoint at `/api/workspace/schemas`) are load-bearing.

---

## File map

**Create:**
- `packages/ide/src/store/selection.ts` — Zustand selection store
- `packages/ide/src/store/selection.test.ts`
- `packages/ide/src/workflow/add-node.ts` — pure `addNode(wf, uses, position)` helper
- `packages/ide/src/workflow/add-node.test.ts`
- `packages/ide/src/workflow/delete-node.ts` — pure `deleteNode(wf, id)` helper (with ref cleanup)
- `packages/ide/src/workflow/delete-node.test.ts`
- `packages/ide/src/workflow/delete-edge.ts` — pure `removeMappings(wf, mappings)` helper
- `packages/ide/src/workflow/delete-edge.test.ts`
- `packages/ide/src/workflow/add-node-palette.tsx` — searchable list component
- `packages/ide/src/workflow/add-node-palette.test.tsx`
- `packages/ide/src/workflow/command-palette.tsx` — Ctrl+K Dialog wrapper
- `packages/ide/src/workflow/command-palette.test.tsx`
- `packages/ide/src/workflow/canvas-context-menu.tsx` — right-click Popover wrapper
- `packages/ide/src/workflow/canvas-context-menu.test.tsx`
- `packages/ide/src/workflow/new-node-dialog.tsx` — "New custom node" modal
- `packages/ide/src/workflow/new-node-dialog.test.tsx`
- `packages/ide/src/components/ui/dialog.tsx` — shadcn Dialog (via CLI)
- `packages/ide/src/components/ui/popover.tsx` — shadcn Popover (via CLI)
- `packages/ide/src/components/ui/command.tsx` — shadcn Command (via CLI, uses cmdk)
- `packages/ide/src/components/ui/input.tsx` — shadcn Input (via CLI)

**Modify:**
- `packages/ide/src/workflow/workflow-editor.tsx` — wire onNodeClick, onPaneClick, onNodesDelete, onEdgesDelete, onReconnectEnd, onPaneContextMenu, onDrop, onDragOver
- `packages/ide/src/panels/inspector-panel.tsx` — replace Inspect tab placeholder with real content
- `packages/ide/src/panels/files-panel.tsx` — make .ts file leaves draggable
- `packages/ide/src/lib/api.ts` — add `createWorkspaceFile(path, content)` helper
- `packages/build/src/commands/ide.ts` — PUT route gains `?create=true` query that 409s if exists

---

## Tasks

### Task 1: Selection store

**Files:**
- Create: `packages/ide/src/store/selection.ts`
- Create: `packages/ide/src/store/selection.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/ide/src/store/selection.test.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest"
import { useSelectionStore } from "./selection"

describe("useSelectionStore", () => {
  afterEach(() => {
    useSelectionStore.setState({ selectedNodeId: null })
  })

  it("starts with no selection", () => {
    expect(useSelectionStore.getState().selectedNodeId).toBeNull()
  })

  it("setSelected stores the id", () => {
    useSelectionStore.getState().setSelected("save")
    expect(useSelectionStore.getState().selectedNodeId).toBe("save")
  })

  it("setSelected(null) clears", () => {
    useSelectionStore.getState().setSelected("save")
    useSelectionStore.getState().setSelected(null)
    expect(useSelectionStore.getState().selectedNodeId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL (module not found)**

Run: `pnpm --filter @darrylondil/lorien-ide test selection -- --run`
Expected: FAIL with "Cannot find module './selection'"

- [ ] **Step 3: Implement**

`packages/ide/src/store/selection.ts`:
```ts
import { create } from "zustand"

interface SelectionState {
  selectedNodeId: string | null
  setSelected: (id: string | null) => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedNodeId: null,
  setSelected: (id) => set({ selectedNodeId: id }),
}))
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm --filter @darrylondil/lorien-ide test selection -- --run`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add packages/ide/src/store/selection.ts packages/ide/src/store/selection.test.ts
git commit -m "feat(ide): selection Zustand store for selected workflow node"
```

---

### Task 2: addNode helper

**Files:**
- Create: `packages/ide/src/workflow/add-node.ts`
- Create: `packages/ide/src/workflow/add-node.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/ide/src/workflow/add-node.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { addNode } from "./add-node"

const baseWorkflow: WorkflowFile = {
  lorien: 1,
  nodes: { request: { uses: "@core/http-request" } },
  view: { request: { x: 0, y: 0 } },
}

describe("addNode", () => {
  it("adds a new node with a unique id and the given uses + position", () => {
    const next = addNode(baseWorkflow, "@core/response", { x: 200, y: 100 })
    expect(Object.keys(next.nodes)).toHaveLength(2)
    const newId = Object.keys(next.nodes).find((id) => id !== "request")!
    expect(next.nodes[newId]).toEqual({ uses: "@core/response" })
    expect(next.view![newId]).toEqual({ x: 200, y: 100 })
  })

  it("derives the id from the last segment of `uses` slugified", () => {
    const next = addNode(baseWorkflow, "./nodes/users/save-user", { x: 0, y: 0 })
    const newId = Object.keys(next.nodes).find((id) => id !== "request")!
    expect(newId).toBe("save-user")
  })

  it("appends an integer suffix on collision", () => {
    const wf: WorkflowFile = {
      ...baseWorkflow,
      nodes: { ...baseWorkflow.nodes, "save-user": { uses: "./x" } },
    }
    const next = addNode(wf, "./nodes/users/save-user", { x: 0, y: 0 })
    const newIds = Object.keys(next.nodes).filter((id) => id !== "request" && id !== "save-user")
    expect(newIds).toEqual(["save-user-2"])
  })

  it("strips the @core/ prefix for @core nodes", () => {
    const next = addNode(baseWorkflow, "@core/response", { x: 0, y: 0 })
    const newId = Object.keys(next.nodes).find((id) => id !== "request")!
    expect(newId).toBe("response")
  })

  it("does not mutate the original workflow", () => {
    const before = JSON.stringify(baseWorkflow)
    addNode(baseWorkflow, "@core/response", { x: 0, y: 0 })
    expect(JSON.stringify(baseWorkflow)).toBe(before)
  })
})
```

- [ ] **Step 2: Implement**

`packages/ide/src/workflow/add-node.ts`:
```ts
import type { WorkflowFile } from "@/lib/api"

/**
 * Returns a new workflow with a new node appended. Generates a unique id
 * from the last segment of `uses` and assigns it the given position in `view`.
 */
export function addNode(
  wf: WorkflowFile,
  uses: string,
  position: { x: number; y: number },
): WorkflowFile {
  const baseId = idFromUses(uses)
  const id = uniqueId(baseId, new Set(Object.keys(wf.nodes)))
  return {
    ...wf,
    nodes: { ...wf.nodes, [id]: { uses } },
    view: { ...(wf.view ?? {}), [id]: position },
  }
}

function idFromUses(uses: string): string {
  const stripped = uses.startsWith("@core/") ? uses.slice("@core/".length) : uses
  const last = stripped.split("/").filter(Boolean).pop() ?? "node"
  return last.replace(/\.[tj]sx?$/, "").replace(/[^a-zA-Z0-9-]/g, "-")
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let i = 2; i < 10000; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error("failed to allocate unique node id")
}
```

- [ ] **Step 3: Run test — expect PASS**

Run: `pnpm --filter @darrylondil/lorien-ide test add-node -- --run`
Expected: PASS (5/5)

- [ ] **Step 4: Commit**

```bash
git add packages/ide/src/workflow/add-node.ts packages/ide/src/workflow/add-node.test.ts
git commit -m "feat(ide): addNode helper with unique-id allocation"
```

---

### Task 3: deleteNode helper (with reference cleanup)

**Files:**
- Create: `packages/ide/src/workflow/delete-node.ts`
- Create: `packages/ide/src/workflow/delete-node.test.ts`

- [ ] **Step 1: Write tests**

`packages/ide/src/workflow/delete-node.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { deleteNode } from "./delete-node"

const wf: WorkflowFile = {
  lorien: 1,
  nodes: {
    request: { uses: "@core/http-request" },
    save: {
      uses: "./nodes/save",
      in: { email: "request.body.email", password: "request.body.password" },
    },
    response: {
      uses: "@core/response",
      in: { body: "save.user", status: 201 },
    },
    log: { uses: "./nodes/log", in: "save.user" },
  },
  view: {
    request: { x: 0, y: 0 },
    save: { x: 100, y: 0 },
    response: { x: 200, y: 0 },
    log: { x: 200, y: 100 },
  },
}

describe("deleteNode", () => {
  it("removes the node from `nodes` and `view`", () => {
    const next = deleteNode(wf, "save")
    expect(next.nodes.save).toBeUndefined()
    expect(next.view?.save).toBeUndefined()
  })

  it("strips per-field `in:` entries pointing at the deleted node", () => {
    const next = deleteNode(wf, "save")
    expect(next.nodes.response?.in).toEqual({ status: 201 }) // body removed
  })

  it("clears whole-object `in:` strings pointing at the deleted node", () => {
    const next = deleteNode(wf, "save")
    expect(next.nodes.log?.in).toBeUndefined() // string-form ref scrubbed
  })

  it("does not strip references that are literal values", () => {
    const next = deleteNode(wf, "save")
    expect(next.nodes.response?.in).toMatchObject({ status: 201 })
  })

  it("returns wf unchanged when id doesn't exist", () => {
    const next = deleteNode(wf, "nonexistent")
    expect(next).toEqual(wf)
  })

  it("does not mutate the input", () => {
    const before = JSON.stringify(wf)
    deleteNode(wf, "save")
    expect(JSON.stringify(wf)).toBe(before)
  })
})
```

- [ ] **Step 2: Implement**

`packages/ide/src/workflow/delete-node.ts`:
```ts
import type { NodeInstance, WorkflowFile } from "@/lib/api"

/**
 * Removes a node from the workflow and strips any `in:` references in other
 * nodes that pointed at it. Supports both per-field (`in: {...}`) and
 * whole-object (`in: "..."`) forms. Returns the original wf if id is absent.
 */
export function deleteNode(wf: WorkflowFile, id: string): WorkflowFile {
  if (!wf.nodes[id]) return wf
  const { [id]: _gone, ...remaining } = wf.nodes

  const scrubbedNodes: Record<string, NodeInstance> = {}
  for (const [otherId, instance] of Object.entries(remaining)) {
    scrubbedNodes[otherId] = scrubReferences(instance, id)
  }

  const view = wf.view ? { ...wf.view } : undefined
  if (view) delete view[id]

  const out: WorkflowFile = { ...wf, nodes: scrubbedNodes }
  if (view) out.view = view
  return out
}

function scrubReferences(node: NodeInstance, deletedId: string): NodeInstance {
  if (!node.in) return node
  if (typeof node.in === "string") {
    if (node.in === deletedId || node.in.startsWith(`${deletedId}.`)) {
      const { in: _drop, ...rest } = node
      return rest
    }
    return node
  }
  // per-field object form
  const nextIn: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(node.in)) {
    if (typeof value === "string" && (value === deletedId || value.startsWith(`${deletedId}.`))) {
      continue // strip
    }
    nextIn[field] = value
  }
  return Object.keys(nextIn).length === 0
    ? (() => { const { in: _drop, ...rest } = node; return rest })()
    : { ...node, in: nextIn }
}
```

- [ ] **Step 3: Run tests — expect PASS**

Run: `pnpm --filter @darrylondil/lorien-ide test delete-node -- --run`
Expected: PASS (6/6)

- [ ] **Step 4: Commit**

```bash
git add packages/ide/src/workflow/delete-node.ts packages/ide/src/workflow/delete-node.test.ts
git commit -m "feat(ide): deleteNode helper with reference cleanup"
```

---

### Task 4: removeMappings helper (edge delete)

**Files:**
- Create: `packages/ide/src/workflow/delete-edge.ts`
- Create: `packages/ide/src/workflow/delete-edge.test.ts`

A merged edge in the workflow editor carries `data.mappings: { source, target }[]`. Each mapping corresponds to one entry in the target node's `in:` block. Deleting an edge means deleting every underlying mapping.

- [ ] **Step 1: Write tests**

`packages/ide/src/workflow/delete-edge.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { removeMappings } from "./delete-edge"

const wf: WorkflowFile = {
  lorien: 1,
  nodes: {
    request: { uses: "@core/http-request" },
    save: { uses: "./save", in: { email: "request.body.email", password: "request.body.password" } },
    log: { uses: "./log", in: "save.user" },
  },
}

describe("removeMappings", () => {
  it("removes a single per-field mapping", () => {
    const next = removeMappings(wf, [{ source: "request.body.email", target: "save.email" }])
    expect(next.nodes.save?.in).toEqual({ password: "request.body.password" })
  })

  it("removes multiple per-field mappings in one call", () => {
    const next = removeMappings(wf, [
      { source: "request.body.email", target: "save.email" },
      { source: "request.body.password", target: "save.password" },
    ])
    expect(next.nodes.save?.in).toBeUndefined()
  })

  it("clears whole-object string in: when its sole mapping is removed", () => {
    const next = removeMappings(wf, [{ source: "save.user", target: "log" }])
    expect(next.nodes.log?.in).toBeUndefined()
  })

  it("returns wf unchanged when no mappings match", () => {
    const next = removeMappings(wf, [{ source: "x.y", target: "save.email" }])
    expect(next.nodes.save?.in).toEqual(wf.nodes.save?.in) // unchanged because the source doesn't match
  })
})
```

- [ ] **Step 2: Implement**

`packages/ide/src/workflow/delete-edge.ts`:
```ts
import type { NodeInstance, WorkflowFile } from "@/lib/api"
import type { PathMapping } from "./path-edge"

/**
 * Given a list of source→target path mappings, remove the corresponding
 * entries from each target node's `in:` block. `target` of "node" (no dot)
 * means whole-object form; "node.field" means per-field.
 */
export function removeMappings(wf: WorkflowFile, mappings: PathMapping[]): WorkflowFile {
  // Group by target nodeId
  const byTarget = new Map<string, PathMapping[]>()
  for (const m of mappings) {
    const [tNode] = m.target.split(".", 1)
    if (!tNode) continue
    if (!byTarget.has(tNode)) byTarget.set(tNode, [])
    byTarget.get(tNode)!.push(m)
  }

  const nextNodes: Record<string, NodeInstance> = { ...wf.nodes }
  for (const [tNode, group] of byTarget) {
    const inst = nextNodes[tNode]
    if (!inst || !inst.in) continue
    nextNodes[tNode] = applyMappingRemovals(inst, group)
  }
  return { ...wf, nodes: nextNodes }
}

function applyMappingRemovals(inst: NodeInstance, mappings: PathMapping[]): NodeInstance {
  if (typeof inst.in === "string") {
    // Any mapping with target = nodeId (no dot) clears the string
    const wholeObjectHit = mappings.some((m) => !m.target.includes("."))
    if (!wholeObjectHit) return inst
    const { in: _drop, ...rest } = inst
    return rest
  }
  const nextIn: Record<string, unknown> = { ...inst.in }
  for (const m of mappings) {
    const [, ...rest] = m.target.split(".")
    const field = rest.join(".")
    if (!field) continue
    // Only delete if the current value matches the mapping's source
    if (nextIn[field] === m.source) delete nextIn[field]
  }
  if (Object.keys(nextIn).length === 0) {
    const { in: _drop, ...withoutIn } = inst
    return withoutIn
  }
  return { ...inst, in: nextIn }
}
```

- [ ] **Step 3: Run tests — expect PASS**

Run: `pnpm --filter @darrylondil/lorien-ide test delete-edge -- --run`
Expected: PASS (4/4)

- [ ] **Step 4: Commit**

```bash
git add packages/ide/src/workflow/delete-edge.ts packages/ide/src/workflow/delete-edge.test.ts
git commit -m "feat(ide): removeMappings helper for edge deletion"
```

---

### Task 5: AddNodePalette component

**Files:**
- Create: `packages/ide/src/workflow/add-node-palette.tsx`
- Create: `packages/ide/src/workflow/add-node-palette.test.tsx`

Requires shadcn `command` and `input`. Install both first.

- [ ] **Step 1: Install shadcn components**

```bash
cd packages/ide
node_modules/.bin/pnpm dlx shadcn@latest add command input --yes
```

If the CLI lands files at literal `@/components/ui/`, move them to `packages/ide/src/components/ui/`. Verify the files exist at the right path.

- [ ] **Step 2: Write test**

`packages/ide/src/workflow/add-node-palette.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AddNodePalette } from "./add-node-palette"

const schemas = {
  "@core/http-request": { color: null, inputs: {}, outputs: {} },
  "@core/response": { color: null, inputs: {}, outputs: {} },
  "./nodes/save-user": { color: null, inputs: {}, outputs: {} },
}

describe("AddNodePalette", () => {
  it("lists all schema keys", () => {
    render(<AddNodePalette schemas={schemas as never} onPick={vi.fn()} />)
    expect(screen.getByText("@core/http-request")).toBeInTheDocument()
    expect(screen.getByText("@core/response")).toBeInTheDocument()
    expect(screen.getByText("./nodes/save-user")).toBeInTheDocument()
  })

  it("filters by search query", () => {
    render(<AddNodePalette schemas={schemas as never} onPick={vi.fn()} />)
    const input = screen.getByPlaceholderText(/search/i)
    fireEvent.change(input, { target: { value: "save" } })
    expect(screen.queryByText("@core/http-request")).not.toBeInTheDocument()
    expect(screen.getByText("./nodes/save-user")).toBeInTheDocument()
  })

  it("calls onPick with the chosen `uses` when an item is clicked", () => {
    const onPick = vi.fn()
    render(<AddNodePalette schemas={schemas as never} onPick={onPick} />)
    fireEvent.click(screen.getByText("@core/response"))
    expect(onPick).toHaveBeenCalledWith("@core/response")
  })
})
```

- [ ] **Step 3: Implement**

`packages/ide/src/workflow/add-node-palette.tsx`:
```tsx
import { useState } from "react"
import { Input } from "@/components/ui/input"
import type { NodeSchemas } from "@/lib/api"

interface Props {
  schemas: Record<string, NodeSchemas>
  onPick: (uses: string) => void
}

export function AddNodePalette({ schemas, onPick }: Props) {
  const [query, setQuery] = useState("")
  const items = Object.keys(schemas).sort(coreFirst)
  const filtered = query
    ? items.filter((k) => k.toLowerCase().includes(query.toLowerCase()))
    : items

  return (
    <div className="flex flex-col">
      <Input
        autoFocus
        placeholder="Search node types…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="m-2"
      />
      <div className="max-h-64 overflow-auto p-1">
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
        )}
        {filtered.map((uses) => {
          const color = schemas[uses]?.color
          return (
            <button
              type="button"
              key={uses}
              onClick={() => onPick(uses)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              {color && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: color }}
                />
              )}
              <span className="font-mono text-xs">{uses}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function coreFirst(a: string, b: string): number {
  const aCore = a.startsWith("@core/")
  const bCore = b.startsWith("@core/")
  if (aCore && !bCore) return -1
  if (!aCore && bCore) return 1
  return a.localeCompare(b)
}
```

- [ ] **Step 4: Run tests + typecheck — expect PASS**

```bash
pnpm --filter @darrylondil/lorien-ide test add-node-palette -- --run
pnpm --filter @darrylondil/lorien-ide typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/ide/src/workflow/add-node-palette.tsx packages/ide/src/workflow/add-node-palette.test.tsx packages/ide/src/components/ui/
git commit -m "feat(ide): AddNodePalette searchable picker + shadcn command/input"
```

---

### Task 6: Ctrl+K command palette

**Files:**
- Create: `packages/ide/src/workflow/command-palette.tsx`
- Create: `packages/ide/src/workflow/command-palette.test.tsx`
- Modify: `packages/ide/src/workflow/workflow-editor.tsx` (add `<CommandPalette>` + addNode wiring + viewport-center math)

Requires shadcn `dialog`.

- [ ] **Step 1: Install shadcn dialog**

```bash
cd packages/ide
node_modules/.bin/pnpm dlx shadcn@latest add dialog --yes
```

(Move to `src/components/ui/` if needed.)

- [ ] **Step 2: Write test**

`packages/ide/src/workflow/command-palette.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CommandPalette } from "./command-palette"

const schemas = { "@core/response": { color: null, inputs: {}, outputs: {} } }

describe("CommandPalette", () => {
  it("opens on Ctrl+K and lists schemas", () => {
    render(<CommandPalette schemas={schemas as never} onPick={vi.fn()} />)
    expect(screen.queryByText("@core/response")).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    expect(screen.getByText("@core/response")).toBeInTheDocument()
  })

  it("calls onPick and closes when an item is selected", () => {
    const onPick = vi.fn()
    render(<CommandPalette schemas={schemas as never} onPick={onPick} />)
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.click(screen.getByText("@core/response"))
    expect(onPick).toHaveBeenCalledWith("@core/response")
    expect(screen.queryByText("@core/response")).not.toBeInTheDocument()
  })

  it("Escape closes without calling onPick", () => {
    const onPick = vi.fn()
    render(<CommandPalette schemas={schemas as never} onPick={onPick} />)
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onPick).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Implement**

`packages/ide/src/workflow/command-palette.tsx`:
```tsx
import { useEffect, useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import type { NodeSchemas } from "@/lib/api"
import { AddNodePalette } from "./add-node-palette"

interface Props {
  schemas: Record<string, NodeSchemas>
  onPick: (uses: string) => void
}

export function CommandPalette({ schemas, onPick }: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0">
        <AddNodePalette
          schemas={schemas}
          onPick={(uses) => {
            setOpen(false)
            onPick(uses)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Wire into workflow-editor**

In `packages/ide/src/workflow/workflow-editor.tsx`:
- Import `CommandPalette` and `addNode`
- Use `useReactFlow` hook to get viewport center: `const { screenToFlowPosition } = useReactFlow()` — but `useReactFlow` requires a `<ReactFlowProvider>` wrapper higher up. If the existing editor isn't wrapped, get the center from the React Flow instance's `getViewport()` math. Alternative: use `(window.innerWidth/2, window.innerHeight/2)` translated via the existing flow instance ref.
- For v1, hardcode a sensible default: place new nodes near the top-left of the visible area: `{ x: 100, y: 100 }` and let the user drag.

Add to JSX (inside the outer div):
```tsx
<CommandPalette
  schemas={schemas}
  onPick={(uses) => {
    if (!workflowRef.current) return
    const next = addNode(workflowRef.current, uses, { x: 100, y: 100 })
    workflowRef.current = next
    setWorkflow(next)
    markDirty(true)
  }}
/>
```

- [ ] **Step 5: Run tests + typecheck — expect PASS**

```bash
pnpm --filter @darrylondil/lorien-ide test command-palette -- --run
pnpm --filter @darrylondil/lorien-ide test workflow-editor -- --run
pnpm --filter @darrylondil/lorien-ide typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/ide/src/workflow/command-palette.tsx packages/ide/src/workflow/command-palette.test.tsx packages/ide/src/workflow/workflow-editor.tsx packages/ide/src/components/ui/dialog.tsx
git commit -m "feat(ide): Ctrl+K command palette for adding nodes"
```

---

### Task 7: Right-click context menu

**Files:**
- Create: `packages/ide/src/workflow/canvas-context-menu.tsx`
- Create: `packages/ide/src/workflow/canvas-context-menu.test.tsx`
- Modify: `packages/ide/src/workflow/workflow-editor.tsx` (add `onPaneContextMenu` handler + render `<CanvasContextMenu>`)

Requires shadcn `popover`.

- [ ] **Step 1: Install shadcn popover**

```bash
cd packages/ide
node_modules/.bin/pnpm dlx shadcn@latest add popover --yes
```

- [ ] **Step 2: Write tests + implement together**

`packages/ide/src/workflow/canvas-context-menu.tsx`:
```tsx
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { NodeSchemas } from "@/lib/api"
import { AddNodePalette } from "./add-node-palette"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  x: number
  y: number
  schemas: Record<string, NodeSchemas>
  onPick: (uses: string) => void
  onNewCustomNode: () => void
}

export function CanvasContextMenu({ open, onOpenChange, x, y, schemas, onPick, onNewCustomNode }: Props) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <div
          style={{
            position: "fixed",
            left: x,
            top: y,
            width: 1,
            height: 1,
            pointerEvents: "none",
          }}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <AddNodePalette
          schemas={schemas}
          onPick={(uses) => {
            onOpenChange(false)
            onPick(uses)
          }}
        />
        <div className="border-t p-2">
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              onNewCustomNode()
            }}
            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            + New custom node…
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

`canvas-context-menu.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CanvasContextMenu } from "./canvas-context-menu"

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
```

- [ ] **Step 3: Wire into workflow-editor**

In `packages/ide/src/workflow/workflow-editor.tsx`:
```ts
const [menu, setMenu] = useState<{ open: boolean; x: number; y: number; flowX: number; flowY: number }>(
  { open: false, x: 0, y: 0, flowX: 0, flowY: 0 }
)
const reactFlowRef = useRef<HTMLDivElement | null>(null)

const onPaneContextMenu = useCallback((event: ReactMouseEvent | MouseEvent) => {
  event.preventDefault()
  const bounds = reactFlowRef.current?.getBoundingClientRect()
  const flowX = bounds ? event.clientX - bounds.left : event.clientX
  const flowY = bounds ? event.clientY - bounds.top : event.clientY
  setMenu({ open: true, x: event.clientX, y: event.clientY, flowX, flowY })
}, [])
```

Add `<ReactFlow ref={reactFlowRef} onPaneContextMenu={onPaneContextMenu} ...>` and render `<CanvasContextMenu>` inside the outer div, passing `onPick={(uses) => addNodeAt(uses, menu.flowX, menu.flowY)}`.

Defer "New custom node" wiring to Task 8 (use a placeholder `() => {}` for now).

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @darrylondil/lorien-ide test canvas-context-menu workflow-editor -- --run
pnpm --filter @darrylondil/lorien-ide typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/ide/src/workflow/canvas-context-menu.tsx packages/ide/src/workflow/canvas-context-menu.test.tsx packages/ide/src/workflow/workflow-editor.tsx packages/ide/src/components/ui/popover.tsx
git commit -m "feat(ide): right-click canvas opens add-node context menu"
```

---

### Task 8: New custom node dialog + backend create endpoint

**Files:**
- Modify: `packages/build/src/commands/ide.ts` (PUT route accepts `?create=true` query; 409 if file already exists)
- Modify: `packages/build/src/commands/ide.test.ts`
- Modify: `packages/ide/src/lib/api.ts` — add `createWorkspaceFile(path, content)`
- Create: `packages/ide/src/workflow/new-node-dialog.tsx`
- Create: `packages/ide/src/workflow/new-node-dialog.test.tsx`
- Modify: `packages/ide/src/workflow/workflow-editor.tsx` (wire `onNewCustomNode`)

- [ ] **Step 1: Backend — add create-only mode to PUT route**

In `packages/build/src/commands/ide.ts`, find the PUT route for file content. Add a `?create=true` query parameter. If set, the route writes the file ONLY if it doesn't already exist; otherwise returns 409 Conflict.

Test in `ide.test.ts`:
```ts
it("PUT /api/workspace/file?create=true 409s when the file already exists", async () => {
  const res = await app.request(`/api/workspace/file?path=${encodeURIComponent("nodes/users/save-user.ts")}&create=true`, {
    method: "PUT",
    body: "content",
  })
  expect(res.status).toBe(409)
})

it("PUT /api/workspace/file?create=true writes when the file is new", async () => {
  const res = await app.request(`/api/workspace/file?path=nodes%2Fbrand-new.ts&create=true`, {
    method: "PUT",
    body: "content",
  })
  expect(res.status).toBe(200)
  // cleanup
})
```

Implement using `fs.access` (throws on missing). On 409, do not touch the file.

- [ ] **Step 2: Frontend API helper**

In `packages/ide/src/lib/api.ts`:
```ts
export async function createWorkspaceFile(path: string, content: string): Promise<void> {
  const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(path)}&create=true`, {
    method: "PUT",
    body: content,
  })
  if (res.status === 409) throw new Error("File already exists")
  if (!res.ok) throw new Error(`PUT failed: ${res.status}`)
}
```

- [ ] **Step 3: NewNodeDialog component**

`packages/ide/src/workflow/new-node-dialog.tsx`:
```tsx
import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { createWorkspaceFile } from "@/lib/api"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the relative `uses` path after the file is created. */
  onCreated: (uses: string) => void
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

export function NewNodeDialog({ open, onOpenChange, onCreated }: Props) {
  const [path, setPath] = useState("nodes/")
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    setError(null)
    let p = path.trim()
    if (!p.endsWith(".ts")) p = `${p}.ts`
    try {
      await createWorkspaceFile(p, TEMPLATE)
      // The `uses` form is "./<path>" without ".ts"
      const uses = `./${p.replace(/\.ts$/, "")}`
      onOpenChange(false)
      onCreated(uses)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New custom node</DialogTitle>
        </DialogHeader>
        <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="nodes/my-node.ts" />
        {error && <div className="text-sm text-destructive">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className="rounded px-3 py-1.5 text-sm hover:bg-accent">
            Cancel
          </button>
          <button type="button" onClick={handleCreate} className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            Create
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Tests**

`new-node-dialog.test.tsx`: mock `createWorkspaceFile`; verify it's called with the right path + template; verify error display on 409; verify onCreated fires with the right `uses`.

- [ ] **Step 5: Wire into workflow-editor**

In `workflow-editor.tsx`:
```tsx
const [newNodeOpen, setNewNodeOpen] = useState(false)
// ...
<CanvasContextMenu
  ...
  onNewCustomNode={() => setNewNodeOpen(true)}
/>
<NewNodeDialog
  open={newNodeOpen}
  onOpenChange={setNewNodeOpen}
  onCreated={(uses) => {
    // Re-fetch schemas so the new node type appears in the palette
    fetchWorkspaceSchemas().then(setSchemas).catch(() => {})
    // Add a node at the last-known context-menu position
    addNodeAt(uses, menu.flowX, menu.flowY)
  }}
/>
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
pnpm -r test
pnpm -r typecheck
```

- [ ] **Step 7: Commit**

```bash
git add packages/build/src/commands/ide.ts packages/build/src/commands/ide.test.ts packages/ide/src/lib/api.ts packages/ide/src/workflow/new-node-dialog.tsx packages/ide/src/workflow/new-node-dialog.test.tsx packages/ide/src/workflow/workflow-editor.tsx
git commit -m "feat(ide+build): new custom node dialog + create-only PUT endpoint"
```

---

### Task 9: Drag from files sidebar to canvas

**Files:**
- Modify: `packages/ide/src/panels/files-panel.tsx` — make `.ts` leaves draggable
- Modify: `packages/ide/src/workflow/workflow-editor.tsx` — add `onDrop`/`onDragOver`
- Modify: `packages/ide/src/panels/files-panel.test.tsx` (new test for drag)

- [ ] **Step 1: Make .ts node files draggable**

Edit `Leaf` in `files-panel.tsx`:
```tsx
<button
  type="button"
  draggable={node.kind === "code" && node.path?.endsWith(".ts")}
  onDragStart={(e) => {
    if (node.path && node.path.endsWith(".ts")) {
      // Convert path (e.g. "nodes/save.ts") to a `uses` ref ("./nodes/save")
      const uses = `./${node.path.replace(/\.ts$/, "")}`
      e.dataTransfer.setData("application/lorien-node", uses)
      e.dataTransfer.effectAllowed = "copy"
    }
  }}
  ...
>
```

- [ ] **Step 2: Add onDrop to workflow-editor**

In `workflow-editor.tsx`:
```tsx
const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
  if (e.dataTransfer.types.includes("application/lorien-node")) {
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }
}, [])

const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
  const uses = e.dataTransfer.getData("application/lorien-node")
  if (!uses) return
  e.preventDefault()
  const bounds = reactFlowRef.current?.getBoundingClientRect()
  const x = bounds ? e.clientX - bounds.left : e.clientX
  const y = bounds ? e.clientY - bounds.top : e.clientY
  addNodeAt(uses, x, y)
}, [/* ... */])

// On the outer container div:
<div onDragOver={onDragOver} onDrop={onDrop} className="relative h-full w-full">
```

- [ ] **Step 3: Tests**

In `files-panel.test.tsx`, simulate dragstart on a .ts leaf and assert `dataTransfer.setData` was called with the right payload.

- [ ] **Step 4: Run tests + typecheck — expect PASS**

```bash
pnpm --filter @darrylondil/lorien-ide test -- --run
pnpm --filter @darrylondil/lorien-ide typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/ide/src/panels/files-panel.tsx packages/ide/src/panels/files-panel.test.tsx packages/ide/src/workflow/workflow-editor.tsx
git commit -m "feat(ide): drag node files from sidebar onto workflow canvas"
```

---

### Task 10: Delete nodes + edges + disconnect-by-drag-to-empty

**Files:**
- Modify: `packages/ide/src/workflow/workflow-editor.tsx` — add `onNodesDelete`, `onEdgesDelete`, `onReconnectEnd`
- Modify: `packages/ide/src/workflow/workflow-editor.test.tsx`

- [ ] **Step 1: Add handlers to workflow-editor**

```tsx
const onNodesDelete = useCallback((deleted: RFNode[]) => {
  const wf = workflowRef.current
  if (!wf) return
  let next = wf
  for (const n of deleted) {
    next = deleteNode(next, n.id)
  }
  workflowRef.current = next
  setWorkflow(next)
  markDirty(true)
  // Clear selection if the selected node was deleted
  const selected = useSelectionStore.getState().selectedNodeId
  if (selected && deleted.some((n) => n.id === selected)) {
    useSelectionStore.getState().setSelected(null)
  }
}, [markDirty])

const onEdgesDelete = useCallback((deleted: Edge[]) => {
  const wf = workflowRef.current
  if (!wf) return
  const allMappings: PathMapping[] = []
  for (const e of deleted) {
    const m = (e.data as { mappings?: PathMapping[] } | undefined)?.mappings
    if (m) allMappings.push(...m)
  }
  if (allMappings.length === 0) return
  const next = removeMappings(wf, allMappings)
  workflowRef.current = next
  setWorkflow(next)
  markDirty(true)
}, [markDirty])

const onReconnectEnd = useCallback((_e: MouseEvent | TouchEvent, edge: Edge, isConnected: boolean) => {
  if (isConnected) return  // user re-targeted; React Flow's onReconnect would have fired
  onEdgesDelete([edge])
}, [onEdgesDelete])
```

Pass to `<ReactFlow>`: `onNodesDelete={onNodesDelete} onEdgesDelete={onEdgesDelete} onReconnectEnd={onReconnectEnd}`. React Flow handles Backspace/Delete keyboard shortcuts and dispatches these by default.

- [ ] **Step 2: Tests**

In `workflow-editor.test.tsx`:
```tsx
it("onNodesDelete strips the node from workflow and clears refs", async () => {
  // Render with a workflow that has node A → B
  // Trigger the captured onNodesDelete with [{ id: "B" }]
  // Assert: workflow.nodes.B is undefined; workflow.nodes.A.in is cleaned
})

it("onReconnectEnd with isConnected=false removes the edge's mappings", async () => {
  // Set up an edge with data.mappings = [{ source: "A.x", target: "B.y" }]
  // Trigger captured onReconnectEnd(event, edge, false)
  // Save via Ctrl+S; assert B.in.y is gone
})
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
pnpm --filter @darrylondil/lorien-ide test workflow-editor -- --run
pnpm --filter @darrylondil/lorien-ide typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/ide/src/workflow/workflow-editor.tsx packages/ide/src/workflow/workflow-editor.test.tsx
git commit -m "feat(ide): delete nodes/edges + disconnect by drag-to-empty"
```

---

### Task 11: Inspector panel content + selection wiring

**Files:**
- Modify: `packages/ide/src/workflow/workflow-editor.tsx` — call `useSelectionStore.setSelected` on `onNodeClick` / `onPaneClick`
- Modify: `packages/ide/src/panels/inspector-panel.tsx` — replace Inspect tab placeholder
- Modify: `packages/ide/src/panels/inspector-panel.test.tsx` (new)

- [ ] **Step 1: Selection wiring**

In `workflow-editor.tsx`:
```tsx
import { useSelectionStore } from "@/store/selection"
const setSelected = useSelectionStore((s) => s.setSelected)

const onNodeClick = useCallback((_e: ReactMouseEvent, n: RFNode) => {
  setSelected(n.id)
}, [setSelected])
const onPaneClick = useCallback(() => {
  setSelected(null)
}, [setSelected])

// On <ReactFlow>: onNodeClick={onNodeClick} onPaneClick={onPaneClick}
```

Also reset selection when the active workflow tab changes (subscribe to tabs store inside the editor's effect, or just clear on unmount of the editor):
```tsx
useEffect(() => {
  return () => setSelected(null)
}, [setSelected])
```

- [ ] **Step 2: Inspector content**

Replace the Inspect TabsContent body in `inspector-panel.tsx`. Read selection + tabs to find the active workflow + the selected node + its schema. Render sectioned stack:

```tsx
function InspectContent() {
  const selectedId = useSelectionStore((s) => s.selectedNodeId)
  const activeTab = useActiveWorkflowTab()  // helper that reads the active workflow tab's path
  const [workflow, setWorkflow] = useState<WorkflowFile | null>(null)
  const [schemas, setSchemas] = useState<Record<string, NodeSchemas>>({})

  useEffect(() => {
    if (!activeTab?.path) return
    fetchWorkflowFile(activeTab.path).then(setWorkflow).catch(() => setWorkflow(null))
  }, [activeTab?.path])

  useEffect(() => {
    fetchWorkspaceSchemas().then(setSchemas).catch(() => {})
  }, [])

  // Re-fetch workflow on SSE so the inspector reflects the latest in: bindings
  useEffect(() => {
    return subscribeToFileEvents((e) => {
      if (activeTab?.path && e.path === activeTab.path) {
        fetchWorkflowFile(activeTab.path).then(setWorkflow).catch(() => {})
      }
    })
  }, [activeTab?.path])

  if (!selectedId) {
    return <div className="text-sm text-muted-foreground">No node selected.</div>
  }
  const instance = workflow?.nodes[selectedId]
  if (!instance) {
    return <div className="text-sm text-muted-foreground">Node not found.</div>
  }
  const schema = schemas[instance.uses]

  return (
    <div className="flex flex-col gap-4">
      <Section label="Node">
        <Row k="id" v={selectedId} />
        <Row k="uses" v={instance.uses} />
        {schema?.color && (
          <Row k="color" v={
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm" style={{ background: schema.color }} />
              <span>{schema.color}</span>
            </span>
          } />
        )}
      </Section>
      <Section label="Inputs">
        <SchemaTree schema={schema?.inputs} />
      </Section>
      <Section label="Outputs">
        <SchemaTree schema={schema?.outputs} />
      </Section>
      <Section label="Config">
        {instance.config ? (
          <pre className="rounded bg-muted p-2 text-xs">{JSON.stringify(instance.config, null, 2)}</pre>
        ) : (
          <div className="text-xs text-muted-foreground italic">(none)</div>
        )}
      </Section>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-muted-foreground">{k}:</span>
      <span className="font-mono">{v}</span>
    </div>
  )
}

function SchemaTree({ schema }: { schema?: JsonSchema }) {
  // Render the JSON Schema recursively as an indented type tree.
  // For v1, only top-level properties with their types; chevrons for objects.
  if (!schema || schema.type !== "object" || !schema.properties) {
    return <div className="text-xs text-muted-foreground italic">(empty)</div>
  }
  return (
    <ul className="font-mono text-xs">
      {Object.entries(schema.properties).map(([k, sub]) => (
        <li key={k} className="py-0.5">
          <span>{k}</span>
          <span className="ml-2 text-muted-foreground">({typeOf(sub)})</span>
        </li>
      ))}
    </ul>
  )
}

function typeOf(s?: JsonSchema): string {
  if (!s) return "any"
  if (s.type === "object") return "object"
  if (s.type === "array") return "array"
  if (typeof s.type === "string") return s.type
  return "any"
}
```

You may need to create a small helper `useActiveWorkflowTab()` that reads `useTabsStore` to find the tab with `kind === "workflow"` and `id === activeWorkflowId`.

- [ ] **Step 3: Test**

`inspector-panel.test.tsx`: render with a selected node id in the store, mock fetchWorkflowFile + fetchWorkspaceSchemas, assert the node id, uses, and schema fields appear. Also test the empty state when no selection.

- [ ] **Step 4: Run tests + build smoke — expect PASS**

```bash
pnpm -r test
pnpm -r typecheck
pnpm -r build
```

- [ ] **Step 5: Commit**

```bash
git add packages/ide/src/panels/inspector-panel.tsx packages/ide/src/panels/inspector-panel.test.tsx packages/ide/src/workflow/workflow-editor.tsx
git commit -m "feat(ide): inspector panel renders selected node details"
```

---

## Self-review checklist (run before declaring done)

- All 11 tasks complete and committed
- `pnpm -r test` passes (target ~485+ tests)
- `pnpm -r typecheck` clean
- `pnpm -r build` clean
- Manual smoke (`pnpm dev:demo`):
  - Ctrl+K opens command palette → pick `@core/response` → node appears
  - Right-click empty canvas → menu opens with search + "New custom node" button
  - Drag a `.ts` file from the left sidebar onto canvas → node appears at drop position
  - Click "New custom node" → modal → enter path → file created, schemas re-fetched, node added
  - Select a node in the workflow → Inspector tab populates with id, uses, inputs, outputs
  - Backspace on selected node → node and references removed
  - Backspace on selected edge → edge and `in:` entries removed
  - Grab an edge endpoint, drop on empty canvas → edge disappears, `in:` entry removed
