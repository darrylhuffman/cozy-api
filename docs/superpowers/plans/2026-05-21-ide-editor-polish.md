# IDE Editor Polish (6 Items) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six targeted fixes/features for the Lorien workflow editor: drag-handle restriction, collapse-on-edit bug fix, widget layout, default path, and body-port correction.

**Architecture:** All changes are localized to `workflow-editor.tsx`, `workflow-node.tsx`, `derive-ports.ts`, and their test files. No new files are created. The collapse bug is fixed by reading from the expansion Map at node-init time instead of seeding empty sets.

**Tech Stack:** React, React Flow (@xyflow/react), TypeScript, Vitest, @testing-library/react

---

## File Map

| File | Changes |
|---|---|
| `packages/ide/src/workflow/workflow-editor.tsx` | Item 1 (dragHandle), Item 2 (collapse fix — seed nodes from expansion Map), Item 5 (defaultPathForWorkflow + addNodeAt prefill) |
| `packages/ide/src/workflow/workflow-node.tsx` | Item 1 (node-drag-handle class on header), Item 3 (widget below label) |
| `packages/ide/src/workflow/derive-ports.ts` | Item 6 (filter body from outputs not inputs) |
| `packages/ide/src/workflow/derive-ports.test.ts` | Item 6 (fix existing tests that assert on inputs → assert on outputs) |
| `packages/ide/src/workflow/workflow-editor.test.tsx` | Item 2 (new test: editing value does not collapse port), Item 5 (defaultPathForWorkflow tests) |
| `packages/ide/src/workflow/workflow-node.test.tsx` | Item 3 (assert widget is below label, not inline) |

---

## Task 1: Item 1 — dragHandle in workflow-editor.tsx + node-drag-handle class on header

**Files:**
- Modify: `packages/ide/src/workflow/workflow-editor.tsx:415-443`
- Modify: `packages/ide/src/workflow/workflow-node.tsx:111-121`

- [ ] **Step 1: Add `dragHandle` to each RFNode in workflow-editor.tsx**

In the `initial` array build inside `useEffect` (around line 415), add `dragHandle: ".node-drag-handle"` to the returned object:

```ts
return {
  id,
  type: "workflow",
  position: view ?? autoPosition(i),
  dragHandle: ".node-drag-handle",
  data: { ... },
}
```

- [ ] **Step 2: Add `node-drag-handle` class to the header div in workflow-node.tsx**

Find the header div (the one with `data-testid="node-header"`) and add the class:

```tsx
<div
  data-testid="node-header"
  className="node-drag-handle border-b border-border bg-muted px-3 py-1.5 text-xs"
  style={headerBg ? { background: headerBg } : undefined}
>
```

- [ ] **Step 3: Verify tests still pass (no new tests needed — this is purely visual/behavioural)**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test --reporter=verbose 2>&1 | tail -20
```

---

## Task 2: Item 2/4 — Fix collapse-on-edit bug

**Root cause:** When `onInputValueChange` fires → `setWorkflow(next)` → node-init `useEffect` re-runs (it depends on `workflow`) → it builds new RFNode objects with hardcoded `expandedInputs: new Set<string>()` and `expandedOutputs: new Set<string>()` → the expansion `useEffect` depends on `[expansion]` — since expansion Map didn't change (the guard `if (next.has(id)) continue` preserved it), expansion effect doesn't re-fire → nodes remain with empty expanded sets → everything collapses.

**Fix:** When building the initial nodes array, read from the expansion Map (already in scope via closure) to populate `expandedInputs`/`expandedOutputs` instead of hardcoding empty sets.

**Files:**
- Modify: `packages/ide/src/workflow/workflow-editor.tsx:386-446`
- Modify: `packages/ide/src/workflow/workflow-editor.test.tsx` (add new test)

- [ ] **Step 1: Write the failing test first**

Add a new `describe` block in `workflow-editor.test.tsx` after the existing `"node context menu"` describe, before the closing `})` of the outer `describe("WorkflowEditor")`:

```tsx
describe("inline value editing does not collapse ports (item 2/4 fix)", () => {
  it("editing an input value keeps the port group visible", async () => {
    // Set up schemas so http-request has method+path inputs
    const httpSchemas: Record<string, import("@/lib/api").NodeSchemas> = {
      "@core/http-request": {
        inputs: {
          type: "object",
          properties: {
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
            path: { type: "string" },
          },
        },
        outputs: { type: "object", properties: { body: { type: "object" } } },
      },
    }
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue(httpSchemas)

    const wf: WorkflowFile = {
      lorien: 1,
      nodes: {
        req: {
          uses: "@core/http-request",
          in: {},
        },
      },
    }
    vi.mocked(fetchWorkflowFile).mockResolvedValue(wf)
    render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)

    await waitFor(() => {
      expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("1")
    })

    // The req node's method input should be expandable (root starts expanded
    // because no fields are bound). Find the node data and confirm expandedInputs
    // contains "" (root expanded).
    await waitFor(() => {
      const node = capturedNodes?.find((n) => n.id === "req")
      const expanded = node?.data.expandedInputs as Set<string> | undefined
      expect(expanded?.has("")).toBe(true)
    })

    // Simulate onInputValueChange for method="GET" (as if user picked from dropdown)
    // We need to reach the onInputValueChange callback that was passed to the node.
    const node = capturedNodes?.find((n) => n.id === "req")
    const onInputValueChange = node?.data.onInputValueChange as
      | ((portId: string, value: unknown) => void)
      | undefined
    expect(onInputValueChange).toBeDefined()

    act(() => {
      onInputValueChange!("method", "GET")
    })

    // After value change, the root should STILL be expanded (not collapsed)
    await waitFor(() => {
      const updatedNode = capturedNodes?.find((n) => n.id === "req")
      const expanded = updatedNode?.data.expandedInputs as Set<string> | undefined
      expect(expanded?.has("")).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it FAILS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test --reporter=verbose 2>&1 | grep -E "(FAIL|PASS|editing an input)"
```

Expected: FAIL — the test finds the root is collapsed after editing.

- [ ] **Step 3: Fix workflow-editor.tsx — seed nodes from expansion Map**

In the node-init `useEffect` (the one that depends on `[workflow, schemas, onTogglePort, onInputValueChange]`), change the node construction to read from the current expansion Map. The effect captures `expansion` via closure (it's defined in the component scope). Change:

```ts
// BEFORE (lines ~434-435)
expandedInputs: new Set<string>(),
expandedOutputs: new Set<string>(),
```

to:

```ts
// AFTER — read the already-seeded expansion for this node (if any)
const existingExp = expansion.get(id)
// ...then in the return object:
expandedInputs: existingExp?.inputs ?? new Set<string>(),
expandedOutputs: existingExp?.outputs ?? new Set<string>(),
```

Full change in context (the `initial` array map):

```ts
const initial: RFNode[] = Object.entries(workflow.nodes).map(
  ([id, instance], i) => {
    const view = workflow.view?.[id];
    const np = portsByNode.get(id) ?? {
      inputs: { id: "", label: "input", children: [], isLeaf: true },
      outputs: [],
    };
    const color = schemas[instance.uses]?.color ?? null;
    // Read existing expansion from the Map so that re-runs caused by
    // onInputValueChange don't reset the user's expanded/collapsed state.
    const existingExp = expansion.get(id);
    return {
      id,
      type: "workflow",
      position: view ?? autoPosition(i),
      dragHandle: ".node-drag-handle",
      data: {
        id,
        instance,
        ports: np,
        color,
        expandedInputs: existingExp?.inputs ?? new Set<string>(),
        expandedOutputs: existingExp?.outputs ?? new Set<string>(),
        onTogglePort: (side: "input" | "output", handleId: string) =>
          onTogglePort(id, side, handleId),
        onInputValueChange: (portId: string, value: unknown) =>
          onInputValueChange(id, portId, value),
      },
    };
  },
);
```

Note: `expansion` is captured in the closure here. Since it's a state variable, it IS in scope. We must also add `expansion` to the dependency array of this useEffect to keep the linter happy:

```ts
}, [workflow, schemas, onTogglePort, onInputValueChange, expansion]);
```

**CAUTION:** Adding `expansion` to the deps means this effect re-runs on every expansion toggle — which rebuilds the nodes array. That's actually fine (the expansion effect below also does this), but to avoid double-work we can skip building the array in the expansion effect if we're already doing it here. However, the simpler fix is to just keep both effects: the expansion effect was designed as a fast-path that only updates `expandedInputs`/`expandedOutputs` without rebuilding positions. With `expansion` in the init deps, the expansion effect becomes redundant but harmless. Leave it in.

Actually, a simpler targeted fix: instead of adding `expansion` to deps (which causes rebuild on every toggle), keep the dep array as-is but capture `expansion` via a ref:

```ts
const expansionRef = useRef(expansion);
expansionRef.current = expansion;
```

Then in the effect, use `expansionRef.current.get(id)` instead of `expansion.get(id)`. This way expansion changes don't trigger the full rebuild, but on workflow changes (which is when we need it) the ref is always current.

Use the ref approach:

1. Add `const expansionRef = useRef<Map<string, NodeExpansion>>(new Map())` near the other refs.
2. Keep `expansionRef.current = expansion` as a synchronous assignment in the render body (or in the effect itself since refs don't need effects).
3. In the init effect, use `expansionRef.current.get(id)`.

- [ ] **Step 4: Run the test to verify it PASSES**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test --reporter=verbose 2>&1 | grep -E "(FAIL|PASS|editing an input)"
```

Expected: PASS.

---

## Task 3: Item 3 — Widget below label

**Files:**
- Modify: `packages/ide/src/workflow/workflow-node.tsx:329-365`
- Modify: `packages/ide/src/workflow/workflow-node.test.tsx` (add test)

- [ ] **Step 1: Write failing test**

Add to `workflow-node.test.tsx` inside `describe("inline input editing (B3)")`:

```tsx
it("renders the inline widget in a separate row BELOW the port label, not to the right", () => {
  const schemaLeafFn = (name: string, schema: NonNullable<PortNode["schema"]>): PortNode => {
    const port: PortNode = { id: name, label: name, children: [], isLeaf: true }
    port.schema = schema
    return port
  }
  const ports: NodePorts = {
    inputs: inputRoot([schemaLeafFn("path", { type: "string" })]),
    outputs: [],
  }
  const data: Record<string, unknown> = {
    id: "req",
    instance: { uses: "@core/http-request", in: {} },
    ports,
    expandedInputs: new Set([""]),
    expandedOutputs: new Set<string>(),
    onTogglePort: () => {},
    onInputValueChange: () => {},
  }
  render(<WorkflowNode data={data} />)
  fireEvent.click(screen.getByTestId("chevron-"))
  const widget = screen.getByTestId("input-widget-path")
  const label = screen.getByText("path")

  // The widget should NOT be a sibling of the label in the same flex row.
  // Instead it should be in a child div of the column container,
  // which means label.parentElement !== widget.parentElement.
  expect(widget.closest("div")).not.toBe(label.closest("div[class*='flex items-center']"))
})
```

- [ ] **Step 2: Run to verify FAIL (currently widget and label share the same flex row)**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test --reporter=verbose 2>&1 | grep -E "(FAIL|PASS|separate row)"
```

- [ ] **Step 3: Update PortRow in workflow-node.tsx to render widget below label**

Find the input-side branch of the return JSX in `PortRow` (the part that renders for `!isOutput`). Currently the single row div contains the handle, chevron, label, and widget. Change the outer div from fixed-height `flex items-center` to `flex flex-col` and put the widget in a sub-row:

```tsx
return (
  <>
    <div
      className={cn("relative", inlineWidget ? "flex flex-col" : "flex items-center gap-1")}
      style={{
        minHeight: ROW_HEIGHT,
        paddingLeft: isOutput ? 8 + depth * INDENT_PX : 12,
        paddingRight: isOutput ? 16 + depth * INDENT_PX : 8,
        justifyContent: isOutput ? "flex-end" : "flex-start",
      }}
    >
      <Handle
        type={handleType}
        position={handlePosition}
        id={port.id}
        style={{
          top: inlineWidget ? `${ROW_HEIGHT / 2}px` : "50%",
          transform: "translateY(-50%)",
          width: 10,
          height: 10,
          background: isBranch
            ? "var(--primary, oklch(0.6 0.2 270))"
            : "var(--muted-foreground)",
        }}
      />
      {isOutput ? (
        <>
          {label}
          {chevron}
        </>
      ) : (
        <div className="flex flex-col gap-0.5 w-full">
          <div className="flex items-center gap-1" style={{ height: ROW_HEIGHT }}>
            {chevron}
            {label}
          </div>
          {inlineWidget && (
            <div className="ml-4 pb-1">
              {inlineWidget}
            </div>
          )}
        </div>
      )}
    </div>
    {/* ... children ... */}
  </>
)
```

Wait — the Handle is positioned absolute relative to the row using `top: 50%`. For the input column (not output), we need the handle to still be on the left edge. The current layout uses `position: "relative"` on the outer div and the Handle has absolute positioning via React Flow's default. The Handle's `top: 50%` positions it relative to the row div. If the div grows taller (to accommodate the widget below), we want the handle at the label-row midpoint, not the full div midpoint.

Simpler approach: keep the outer `div` at `ROW_HEIGHT` for the label row, and put the widget in a separate sibling div below (outside the fixed-height row). Use a fragment wrapper:

```tsx
return (
  <>
    <div
      className="relative flex items-center gap-1"
      style={{
        height: ROW_HEIGHT,
        paddingLeft: isOutput ? 8 + depth * INDENT_PX : 12,
        paddingRight: isOutput ? 16 + depth * INDENT_PX : 8,
        justifyContent: isOutput ? "flex-end" : "flex-start",
      }}
    >
      <Handle ... />
      {isOutput ? (
        <>{label}{chevron}</>
      ) : (
        <>{chevron}{label}</>
      )}
    </div>
    {/* Widget row — only for input leaf ports */}
    {inlineWidget && !isOutput && (
      <div
        style={{
          paddingLeft: 12 + depth * INDENT_PX + 16,
          paddingBottom: 4,
        }}
      >
        {inlineWidget}
      </div>
    )}
    {/* Expanded children */}
    {expanded && ( ... existing children rendering ... )}
  </>
)
```

This is the cleanest approach — the Handle stays in a fixed-height row so its `top: 50%` stays correct, and the widget is a separate sibling element below.

- [ ] **Step 4: Run test to verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test --reporter=verbose 2>&1 | grep -E "(FAIL|PASS|separate row)"
```

---

## Task 4: Item 5 — defaultPathForWorkflow + addNodeAt prefill

**Files:**
- Modify: `packages/ide/src/workflow/workflow-editor.tsx` (add helper + update addNodeAt)
- Modify: `packages/ide/src/workflow/workflow-editor.test.tsx` (add tests for defaultPathForWorkflow)

- [ ] **Step 1: Write failing tests for defaultPathForWorkflow**

Add a new describe block in `workflow-editor.test.tsx` at the top-level (before the `describe("WorkflowEditor")` block):

```ts
// Import the exported helper — we'll export it from workflow-editor
import { defaultPathForWorkflow } from "./workflow-editor.js"

describe("defaultPathForWorkflow", () => {
  it('strips "workflows/" prefix, ".workflow" suffix, and drops verb segment', () => {
    expect(defaultPathForWorkflow("workflows/users/create.workflow")).toBe("/users")
  })
  it("strips verb: list", () => {
    expect(defaultPathForWorkflow("workflows/posts/list.workflow")).toBe("/posts")
  })
  it("keeps single non-verb segment", () => {
    expect(defaultPathForWorkflow("workflows/health.workflow")).toBe("/health")
  })
  it("preserves multi-segment non-verb path", () => {
    expect(defaultPathForWorkflow("workflows/admin/users/delete.workflow")).toBe("/admin/users")
  })
})
```

- [ ] **Step 2: Run to verify FAIL (function not yet exported)**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test --reporter=verbose 2>&1 | grep -E "(FAIL|PASS|defaultPath)"
```

- [ ] **Step 3: Add and export defaultPathForWorkflow in workflow-editor.tsx**

Add just before the `WorkflowEditor` function (or at the bottom after `autoPosition`):

```ts
/**
 * Derives a default HTTP path from the workflow file path.
 * e.g. "workflows/users/create.workflow" → "/users"
 *      "workflows/admin/users/delete.workflow" → "/admin/users"
 *      "workflows/health.workflow" → "/health"
 */
export function defaultPathForWorkflow(workflowPath: string): string {
  const stripped = workflowPath
    .replace(/^workflows\//, "")
    .replace(/\.workflow$/, "")
  const parts = stripped.split("/").filter(Boolean)
  if (parts.length === 0) return "/"
  const verbs = new Set(["create", "update", "delete", "list", "get", "show", "index"])
  if (parts.length > 1 && verbs.has(parts[parts.length - 1]!.toLowerCase())) {
    parts.pop()
  }
  return "/" + parts.join("/")
}
```

- [ ] **Step 4: Update addNodeAt to prefill @core/http-request**

Change the `addNodeAt` callback in `WorkflowEditor`:

```ts
const addNodeAt = useCallback(
  (uses: string, x: number, y: number) => {
    const wf = workflowRef.current;
    if (!wf) return;
    let next = addNode(wf, uses, { x, y });
    // For http-request nodes, prefill method + path defaults
    if (uses === "@core/http-request") {
      const newId = Object.keys(next.nodes).find(
        (id) => !wf.nodes[id] && next.nodes[id]?.uses === "@core/http-request",
      );
      if (newId) {
        next = {
          ...next,
          nodes: {
            ...next.nodes,
            [newId]: {
              ...next.nodes[newId]!,
              in: { method: "GET", path: defaultPathForWorkflow(path) },
            },
          },
        };
      }
    }
    applyWorkflow(next);
    markDirty(true);
  },
  [applyWorkflow, markDirty, path],
);
```

- [ ] **Step 5: Run tests to verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test --reporter=verbose 2>&1 | grep -E "(FAIL|PASS|defaultPath)"
```

---

## Task 5: Item 6 — body filtered from OUTPUTS (not inputs) for GET/DELETE

**Files:**
- Modify: `packages/ide/src/workflow/derive-ports.ts:136-152`
- Modify: `packages/ide/src/workflow/derive-ports.test.ts` (fix existing tests + add output-focused tests)

- [ ] **Step 1: Update the failing tests first**

The existing tests in `derive-ports.test.ts` assert that body is hidden from **inputs**. They need to change to assert body is hidden from **outputs**. The test schemas also need to move `body` out of inputs and into outputs.

Replace the four http-request conditional tests (lines 294-386) with:

```ts
describe("@core/http-request body conditional (output side)", () => {
  const httpSchemas: Record<string, NodeSchemas> = {
    "@core/http-request": {
      inputs: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          path: { type: "string" },
        },
      },
      outputs: {
        type: "object",
        properties: {
          body: { type: "object" },
          headers: { type: "object" },
        },
      },
    },
  }

  it("GET → body NOT in outputs", () => {
    const wf = baseWorkflow({
      req: { uses: "@core/http-request", in: { method: "GET", path: "/users" } },
    })
    const ports = derivePorts(wf, httpSchemas)
    const outputIds = ports.get("req")!.outputs.map((p) => p.id)
    expect(outputIds).not.toContain("body")
    expect(outputIds).toContain("headers")
  })

  it("POST → body IS in outputs", () => {
    const wf = baseWorkflow({
      req: { uses: "@core/http-request", in: { method: "POST", path: "/users" } },
    })
    const ports = derivePorts(wf, httpSchemas)
    const outputIds = ports.get("req")!.outputs.map((p) => p.id)
    expect(outputIds).toContain("body")
  })

  it("DELETE → body NOT in outputs", () => {
    const wf = baseWorkflow({
      req: { uses: "@core/http-request", in: { method: "DELETE", path: "/users/1" } },
    })
    const ports = derivePorts(wf, httpSchemas)
    const outputIds = ports.get("req")!.outputs.map((p) => p.id)
    expect(outputIds).not.toContain("body")
  })

  it("config.method='GET' back-compat → body NOT in outputs", () => {
    const wf = baseWorkflow({
      req: { uses: "@core/http-request", config: { method: "GET", path: "/users" } },
    })
    const ports = derivePorts(wf, httpSchemas)
    const outputIds = ports.get("req")!.outputs.map((p) => p.id)
    expect(outputIds).not.toContain("body")
  })
})
```

- [ ] **Step 2: Run tests to verify FAIL (old applyHttpRequestConditional still filters inputs)**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test --reporter=verbose 2>&1 | grep -E "(FAIL|PASS|body.*output)"
```

- [ ] **Step 3: Fix applyHttpRequestConditional in derive-ports.ts**

Replace the function:

```ts
function applyHttpRequestConditional(ports: NodePorts, instance: NodeInstance): NodePorts {
  const inObj =
    typeof instance.in === "object" && instance.in !== null ? instance.in : {}
  const config = (instance.config ?? {}) as Record<string, unknown>
  const method = ((inObj as Record<string, unknown>).method ?? config.method) as string | undefined

  if (method !== "GET" && method !== "DELETE") return ports

  // Filter `body` from OUTPUTS — body is a property of the incoming request
  // (what the trigger produces), not an input to the node. For GET/DELETE,
  // there is no request body, so hide it from the outputs tree.
  return {
    ...ports,
    outputs: ports.outputs.filter((p) => p.id !== "body"),
  }
}
```

Also remove the now-incorrect guard `if (!ports.inputs.children || ports.inputs.children.length === 0) return ports` since we're now filtering outputs (which can be empty or non-empty independently).

- [ ] **Step 4: Run tests to verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test --reporter=verbose 2>&1 | grep -E "(FAIL|PASS|body.*output)"
```

---

## Task 6: Full build + typecheck + test run

- [ ] **Step 1: Run full build**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r build 2>&1 | tail -30
```

- [ ] **Step 2: Run typecheck**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r typecheck 2>&1 | tail -30
```

- [ ] **Step 3: Run all tests and count**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test 2>&1 | tail -30
```

Expected: ~585 tests passing (578 existing + ~7 new).

---

## Task 7: Commit

- [ ] **Step 1: Stage and commit**

```bash
cd C:/Users/hello/source/cozy-api
git add packages/ide/src/workflow/workflow-editor.tsx
git add packages/ide/src/workflow/workflow-node.tsx
git add packages/ide/src/workflow/derive-ports.ts
git add packages/ide/src/workflow/derive-ports.test.ts
git add packages/ide/src/workflow/workflow-editor.test.tsx
git add packages/ide/src/workflow/workflow-node.test.tsx
git commit -m "fix(ide): drag-from-topbar, collapse-on-edit, widget-layout, default-path, body-output

- Nodes are now draggable only from the top bar (React Flow dragHandle)
- Editing an input value no longer collapses its port group; expansion
  state is now sourced entirely from the editor's persistent Map via ref
- Inline input widgets render below the port label, not to the right
- New @core/http-request nodes default to method=GET and a path derived
  from the workflow file location (e.g. workflows/users/create.workflow
  → '/users')
- @core/http-request body is an OUTPUT (not input) that's filtered
  out for GET/DELETE methods — corrects a misdirected fix in 7f77652

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
