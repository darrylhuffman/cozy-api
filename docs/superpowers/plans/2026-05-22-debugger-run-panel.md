# Debugger / Run-panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land subsystem #7 from the cozy-api design: an interactive debugger with lifecycle-event streaming, breakpoints on nodes/output ports, step/continue/step-over/replay controls, and a Run-tab UI inside the IDE's existing Inspector panel. Production codegen is untouched.

**Architecture:** Three layers — (1) the dev interpreter gains optional async pause hooks (`onBeforeNode`, `onAfterNode`) that add zero overhead when undefined; (2) the dev server hosts a `DebugSession` state machine and a `/__lorien/debug/ws` WebSocket endpoint built on the existing `ws` package; (3) the IDE has a Zustand `debug-session` store, a `useDebugTransport` hook for the WS lifecycle, and Run-tab components that render request builder + step controls + timeline. Breakpoints persist in browser `localStorage`.

**Tech Stack:** TypeScript ESM (NodeNext), `ws` (already a dep), Hono, Zod, Vitest, React 19, Zustand, React Flow (`@xyflow/react`), shadcn/ui, `@testing-library/react`. pnpm monorepo. Node 20+.

**Working dir:** `C:\Users\hello\source\cozy-api`. Branch: `feat/ide-editing`. Spec: `docs/superpowers/specs/2026-05-21-debugger-run-panel-design.md`.

**Reading first:** Implementers should skim spec §3 (hook contract), §4 (debug session), §5 (Run-tab UI). The mirror pattern for the WS attach is `packages/runtime/src/agent-broker/server.ts` (`attachAgentBroker`); the URL helper pattern is `packages/ide/src/lib/api.ts` (`wsUrl`).

---

## File map

**Create (runtime):**
- `packages/runtime/src/dev-server/trigger-slice.ts` — extracted helpers (`buildTriggerSlice`, `extractParams`)
- `packages/runtime/src/dev-server/trigger-slice.test.ts` — regression coverage for extraction
- `packages/runtime/src/dev-server/debug-protocol.ts` — wire types (no logic)
- `packages/runtime/src/dev-server/debug-session.ts` — `DebugSession` class
- `packages/runtime/src/dev-server/debug-session.test.ts`
- `packages/runtime/src/dev-server/debug-ws.ts` — `attachDebugWebSocket`
- `packages/runtime/src/dev-server/debug-ws.test.ts`

**Modify (runtime):**
- `packages/runtime/src/exec/run.ts` — add `onBeforeNode`/`onAfterNode` hooks
- `packages/runtime/src/exec/run.test.ts` — hook coverage
- `packages/runtime/src/dev-server/server.ts` — import from `trigger-slice.ts` instead of inlining helpers
- `packages/runtime/src/index.ts` — re-export debug protocol types + `attachDebugWebSocket` + `DebugSession`

**Modify (build):**
- `packages/build/src/commands/ide.ts` — instantiate `DebugSession`, call `attachDebugWebSocket` after `serve()`

**Create (IDE):**
- `packages/ide/src/store/debug-breakpoints-storage.ts`
- `packages/ide/src/store/debug-breakpoints-storage.test.ts`
- `packages/ide/src/store/debug-session.ts`
- `packages/ide/src/store/debug-session.test.ts`
- `packages/ide/src/hooks/use-debug-transport.ts`
- `packages/ide/src/hooks/use-debug-transport.test.tsx`
- `packages/ide/src/panels/run-tab/index.tsx` — top-level `<RunTab>`
- `packages/ide/src/panels/run-tab/trigger-selector.tsx`
- `packages/ide/src/panels/run-tab/request-builder.tsx`
- `packages/ide/src/panels/run-tab/status-banner.tsx`
- `packages/ide/src/panels/run-tab/timeline.tsx`
- `packages/ide/src/panels/run-tab/run-picker.tsx`
- `packages/ide/src/panels/run-tab/run-tab.test.tsx` — colocated end-to-end-ish smoke test

**Modify (IDE):**
- `packages/ide/src/lib/api.ts` — add `debugWsUrl()` helper
- `packages/ide/src/lib/api.test.ts` — coverage for `debugWsUrl()`
- `packages/ide/src/panels/inspector-panel.tsx` — replace Run placeholder with `<RunTab>`
- `packages/ide/src/workflow/workflow-node.tsx` — status borders + breakpoint dots
- `packages/ide/src/workflow/workflow-node.test.tsx` — coverage for borders + dots
- `packages/ide/src/workflow/workflow-editor.tsx` — feed `nodeStatuses` from debug store into RFNode data; context-menu items for breakpoints; edge-fire animation
- `packages/ide/src/workflow/workflow-editor.test.tsx` — coverage for breakpoint context-menu items and status wiring
- `packages/ide/src/globals.css` — keyframes for pulse-blue running animation

---

## Task 1: Extract `trigger-slice.ts`

**Files:**
- Create: `packages/runtime/src/dev-server/trigger-slice.ts`
- Create: `packages/runtime/src/dev-server/trigger-slice.test.ts`
- Modify: `packages/runtime/src/dev-server/server.ts` — import the helpers instead of inlining them

- [ ] **Step 1: Create `trigger-slice.ts`**

Copy `buildTriggerSlice` and `extractParams` verbatim from `server.ts` (currently lines 109+ and 183+ respectively) into a new file. Export both. Don't change their behavior.

```ts
// packages/runtime/src/dev-server/trigger-slice.ts
import type { WorkflowFile } from "../workflow/types.js"

/**
 * Build a projected workflow containing only nodes relevant to the given
 * trigger. Prevents orphan response nodes from one trigger's subgraph from
 * short-circuiting another trigger's execution in multi-trigger workflows.
 *
 * (Implementation: identical to the function currently at server.ts:109+. Move
 * it here verbatim, keeping the same body and behavior.)
 */
export function buildTriggerSlice(
  file: WorkflowFile,
  triggerNodeId: string,
  depsByNode: Map<string, Set<string>>,
): WorkflowFile {
  // ... paste the existing function body from server.ts here unchanged ...
}

/**
 * Extract path params by matching a Hono-style template (e.g. "/users/:id")
 * against a concrete pathname (e.g. "/users/42"). Returns { id: "42" }.
 *
 * (Implementation: identical to the function currently at server.ts:183+.)
 */
export function extractParams(
  template: string,
  actual: string,
): Record<string, string> {
  // ... paste the existing function body from server.ts here unchanged ...
}
```

- [ ] **Step 2: Write the failing test that proves the extraction matches**

`packages/runtime/src/dev-server/trigger-slice.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildTriggerSlice, extractParams } from "./trigger-slice.js"

describe("extractParams", () => {
  it("returns empty object for a no-param template", () => {
    expect(extractParams("/users", "/users")).toEqual({})
  })

  it("extracts a single :param", () => {
    expect(extractParams("/users/:id", "/users/42")).toEqual({ id: "42" })
  })

  it("extracts multiple :params", () => {
    expect(
      extractParams("/orgs/:org/users/:userId", "/orgs/acme/users/42"),
    ).toEqual({ org: "acme", userId: "42" })
  })

  it("returns empty object when paths don't structurally match", () => {
    expect(extractParams("/users/:id", "/posts/42")).toEqual({})
  })
})

describe("buildTriggerSlice", () => {
  it("keeps the trigger and its forward-reachable nodes; drops other triggers", () => {
    const file = {
      lorien: 1 as const,
      nodes: {
        trigA: { uses: "@core/http-request" as const, values: { path: "/a", method: "GET" } },
        trigB: { uses: "@core/http-request" as const, values: { path: "/b", method: "GET" } },
        downA: { uses: "@core/response" as const, in: { body: "trigA.body" } },
        downB: { uses: "@core/response" as const, in: { body: "trigB.body" } },
      },
    }
    const depsByNode = new Map<string, Set<string>>([
      ["trigA", new Set()],
      ["trigB", new Set()],
      ["downA", new Set(["trigA"])],
      ["downB", new Set(["trigB"])],
    ])
    const sliced = buildTriggerSlice(file, "trigA", depsByNode)
    expect(Object.keys(sliced.nodes).sort()).toEqual(["downA", "trigA"])
  })
})
```

- [ ] **Step 3: Run the test to verify it FAILS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test trigger-slice -- --run 2>&1 | tail -20
```

Expected: FAIL because `trigger-slice.ts` doesn't exist yet (or because the test file can't import).

- [ ] **Step 4: Implement `trigger-slice.ts` by moving the helpers from `server.ts`**

Open `packages/runtime/src/dev-server/server.ts` and copy the *exact* function bodies of `buildTriggerSlice` (line 109+) and `extractParams` (line 183+) into `trigger-slice.ts`. Keep imports in sync (e.g., `parseReference` from `../workflow/reference.js`). Export both functions.

- [ ] **Step 5: Update `server.ts` to import from the new module**

Replace the in-file `function buildTriggerSlice(...)` and `function extractParams(...)` declarations with an import at the top of `server.ts`:

```ts
import { buildTriggerSlice, extractParams } from "./trigger-slice.js"
```

Delete the function declarations from `server.ts` (only the declarations — the call sites stay the same).

- [ ] **Step 6: Run all runtime tests to verify nothing else broke**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test 2>&1 | tail -20
```

Expected: all tests pass (the new trigger-slice tests + the existing server/start/run/etc. tests).

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/dev-server/trigger-slice.ts packages/runtime/src/dev-server/trigger-slice.test.ts packages/runtime/src/dev-server/server.ts
git commit -m "refactor(runtime): extract buildTriggerSlice + extractParams to shared module

Move the two helpers out of server.ts so they can be reused by the
upcoming DebugSession (which needs to project the same trigger-slice
during debug-initiated runs). server.ts now imports them from
./trigger-slice.js; behavior is identical.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Runtime — async pause hooks on `runWorkflow`

**Files:**
- Modify: `packages/runtime/src/exec/run.ts` — add `onBeforeNode`/`onAfterNode` to `RunWorkflowOptions`; await them at the documented pause points
- Modify: `packages/runtime/src/exec/run.test.ts` — coverage

- [ ] **Step 1: Write failing tests**

Append to `packages/runtime/src/exec/run.test.ts` (inside the existing top-level `describe`):

```ts
import { defineNode, defineTrigger } from "../define-node.js"
import { z } from "zod"

describe("runWorkflow async pause hooks", () => {
  // Tiny workflow: trigger → echo node → response
  // (Adjust imports/factories to match the patterns already used in this test file.)
  const echo = defineNode({
    name: "echo",
    inputs: z.object({ msg: z.string() }),
    outputs: z.object({ msg: z.string() }),
    async run({ msg }) {
      return { msg }
    },
  })

  function buildTinyWorkflow() {
    // Use whatever the existing tests use for a "trigger -> node -> response"
    // setup. The exact shape should match other tests in this file; if helpers
    // don't exist, inline a workflow with @core/http-request, an echo node,
    // and @core/response that uses echo.msg as its body.
    // ...
  }

  it("calls onBeforeNode before nodeDef.run, in topological order", async () => {
    const calls: string[] = []
    await runWorkflow({
      ...buildTinyWorkflow(),
      onBeforeNode: async (nodeId) => {
        calls.push(`before:${nodeId}`)
      },
    })
    // Trigger short-circuit also hits the hook; the assertion is about order.
    expect(calls).toEqual([
      "before:trigger",
      "before:echo",
      "before:response",
    ])
  })

  it("calls onAfterNode after nodeDef.run, in topological order; not for @core/response", async () => {
    const calls: string[] = []
    await runWorkflow({
      ...buildTinyWorkflow(),
      onAfterNode: async (nodeId) => {
        calls.push(`after:${nodeId}`)
      },
    })
    // Trigger short-circuit calls onAfterNode; response short-circuit does NOT.
    expect(calls).toEqual([
      "after:trigger",
      "after:echo",
    ])
  })

  it("zero overhead when both hooks are undefined (regression guard)", async () => {
    // Smoke check: passing nothing for the hooks runs the same workflow without
    // throwing or changing observable behavior.
    const result = await runWorkflow(buildTinyWorkflow())
    expect(result.status).toBe(200) // or whatever the existing tests assert for this fixture
  })

  it("onBeforeNode runs AFTER Zod input validation (validation failure skips the hook)", async () => {
    const calls: string[] = []
    const failing = defineNode({
      name: "failing",
      inputs: z.object({ msg: z.string() }), // require string
      outputs: z.object({ msg: z.string() }),
      async run({ msg }) {
        return { msg }
      },
    })
    // Wire `failing` with an input that resolves to a non-string (e.g. number).
    // Build a workflow where the upstream reference produces a number for `msg`.
    // ...build that workflow...
    await expect(
      runWorkflow({
        ...buildWorkflowWithBadInput({ failing }),
        onBeforeNode: async (nodeId) => {
          calls.push(`before:${nodeId}`)
        },
      }),
    ).rejects.toThrow(/input validation failed/)
    expect(calls).not.toContain("before:failing")
  })

  it("onAfterNode is NOT called when nodeDef.run throws", async () => {
    const calls: string[] = []
    const throwing = defineNode({
      name: "throwing",
      inputs: z.object({}),
      outputs: z.object({}),
      async run() {
        throw new Error("boom")
      },
    })
    await expect(
      runWorkflow({
        ...buildWorkflowWith({ throwing }),
        onAfterNode: async (nodeId) => {
          calls.push(`after:${nodeId}`)
        },
      }),
    ).rejects.toThrow(/boom/)
    expect(calls).not.toContain("after:throwing")
  })

  it("a hook rejection propagates as NodeRunError and halts the workflow", async () => {
    const downstreamCalls: string[] = []
    await expect(
      runWorkflow({
        ...buildTinyWorkflow(),
        onBeforeNode: async (nodeId) => {
          if (nodeId === "echo") throw new Error("aborted")
        },
        onAfterNode: async (nodeId) => {
          downstreamCalls.push(nodeId)
        },
      }),
    ).rejects.toThrow(/aborted/)
    expect(downstreamCalls).not.toContain("echo")
  })
})
```

NOTE: `buildTinyWorkflow`, `buildWorkflowWithBadInput`, `buildWorkflowWith` are stand-ins. Before writing any of these tests, **read `packages/runtime/src/exec/run.test.ts` to identify the existing helper(s) used by the other tests in this file** (e.g. how they build a `WorkflowFile`, compute the `ExecutionPlan`, and call `runWorkflow`). Reuse those helpers verbatim. The new tests should add only the `onBeforeNode`/`onAfterNode` options to the same harness — they must NOT introduce a parallel test-builder pattern.

- [ ] **Step 2: Run to verify the new cases FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test run.test -- --run 2>&1 | tail -30
```

Expected: the new tests fail (`runWorkflow` doesn't know about `onBeforeNode`/`onAfterNode` yet, so the hooks are never called → assertions fail).

- [ ] **Step 3: Add the hook fields to `RunWorkflowOptions`**

In `packages/runtime/src/exec/run.ts`, extend the interface:

```ts
export interface RunWorkflowOptions {
  workflow: WorkflowFile
  plan: ExecutionPlan
  triggerNodeId: string
  triggerOutputs: Record<string, unknown>
  services: Services
  resolveNode: (uses: string) => AnyNodeOrTrigger | null
  lifecycle?: LifecycleEmitter
  /**
   * Optional async hook called immediately after Zod input validation, before
   * the node's `run()` executes. Dev-only (the debugger uses this to pause).
   * If undefined, the interpreter does not await anything here — zero overhead.
   * If the returned promise rejects, the rejection is wrapped in a
   * `NodeRunError` and the workflow halts per existing fail-fast semantics.
   */
  onBeforeNode?: (nodeId: string, input: Record<string, unknown>) => Promise<void>
  /**
   * Optional async hook called immediately after a node's `run()` returns,
   * after the corresponding `after-node` lifecycle event has been emitted,
   * before downstream nodes can consume the output. Not called when `run()`
   * throws (use lifecycle `error` events for that). Not called for
   * @core/response (which short-circuits without `outputs.set`).
   */
  onAfterNode?: (nodeId: string, output: Record<string, unknown>) => Promise<void>
}
```

- [ ] **Step 4: Insert awaits in `runOneNode` at the documented pause points**

In `packages/runtime/src/exec/run.ts`:

(a) Around line 290 (current `lifecycle?.emit({ type: "before-node", nodeId, input: validatedInput })`), add the hook await IMMEDIATELY after the lifecycle emit:

```ts
lifecycle?.emit({ type: "before-node", nodeId, input: validatedInput })
if (opts.onBeforeNode) {
  try {
    await opts.onBeforeNode(nodeId, validatedInput)
  } catch (err) {
    throw new NodeRunError(nodeId, err)
  }
}
```

(b) Around line 303 (current `lifecycle?.emit({ type: "after-node", ... })`), add the hook await IMMEDIATELY after the lifecycle emit but BEFORE `outputs.set(nodeId, output)`:

```ts
lifecycle?.emit({
  type: "after-node",
  nodeId,
  output,
  durationMs: Date.now() - t0,
})
if (opts.onAfterNode) {
  try {
    await opts.onAfterNode(nodeId, output)
  } catch (err) {
    throw new NodeRunError(nodeId, err)
  }
}
outputs.set(nodeId, output)
```

(c) In the `@core/response` short-circuit branch (around line 253-267), add the `onBeforeNode` call after the `before-node` lifecycle emit, but do NOT call `onAfterNode`:

```ts
if (instance.uses === "@core/response") {
  lifecycle?.emit({ type: "before-node", nodeId, input })
  if (opts.onBeforeNode) {
    try {
      await opts.onBeforeNode(nodeId, input)
    } catch (err) {
      throw new NodeRunError(nodeId, err)
    }
  }
  const response: WorkflowRunResult = {
    status: (input.status as number | undefined) ?? 200,
    body: input.body,
    headers: (input.headers as Record<string, string> | undefined) ?? {},
  }
  lifecycle?.emit({
    type: "after-node",
    nodeId,
    output: { sent: true },
    durationMs: 0,
  })
  return { kind: "response", value: response }
}
```

(d) In `runWorkflow`, in the trigger short-circuit (lines 127-131), call BOTH hooks around the synthetic events:

```ts
if (nodeId === triggerNodeId) {
  lifecycle?.emit({ type: "before-node", nodeId, input: {} })
  if (opts.onBeforeNode) {
    try {
      await opts.onBeforeNode(nodeId, {})
    } catch (err) {
      throw new NodeRunError(nodeId, err)
    }
  }
  lifecycle?.emit({ type: "after-node", nodeId, output: triggerOutputs, durationMs: 0 })
  if (opts.onAfterNode) {
    try {
      await opts.onAfterNode(nodeId, triggerOutputs)
    } catch (err) {
      throw new NodeRunError(nodeId, err)
    }
  }
  continue
}
```

NOTE: `triggerOutputs` is `Record<string, unknown>` per the option type, but spec §3 requires it to match the hook signature. Cast if necessary: `triggerOutputs as Record<string, unknown>`.

- [ ] **Step 5: Run to verify all new tests PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test run.test -- --run 2>&1 | tail -30
```

Expected: PASS for all new cases AND existing cases.

- [ ] **Step 6: Run full runtime test suite**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test 2>&1 | tail -20
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/exec/run.ts packages/runtime/src/exec/run.test.ts
git commit -m "feat(runtime): async onBeforeNode/onAfterNode hooks on runWorkflow

These optional hooks are the pause points the debugger uses. When
undefined, the interpreter awaits nothing — non-debug runs allocate
no promise and incur no microtask overhead. When provided, hook
rejections are wrapped in NodeRunError and halt the workflow per
existing fail-fast semantics.

onBeforeNode runs after Zod input validation; onAfterNode runs after
the after-node lifecycle event but before outputs are exposed
downstream. Response short-circuit calls onBeforeNode only (no
outputs to debug). Trigger short-circuit calls both for
breakpoint-on-trigger support.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Debug protocol — wire types

**Files:**
- Create: `packages/runtime/src/dev-server/debug-protocol.ts`

- [ ] **Step 1: Write the file**

```ts
// packages/runtime/src/dev-server/debug-protocol.ts
import type { LifecycleEvent } from "../exec/lifecycle.js"

/** A breakpoint on a node or output port. Stored per workflow path. */
export interface Breakpoint {
  workflowPath: string
  nodeId: string
  /**
   * - "before"      → pause in onBeforeNode for this node
   * - "after"       → pause in onAfterNode for this node
   * - `port:${id}`  → pause in onAfterNode if this node has a port-bp matching
   */
  kind: "before" | "after" | `port:${string}`
}

/** Synthesized request envelope for a debug-initiated workflow run. */
export interface RequestEnvelope {
  method: string
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
}

export type ClientMessage =
  | { type: "hello"; breakpoints: Breakpoint[] }
  | { type: "set-breakpoints"; breakpoints: Breakpoint[] }
  | {
      type: "fire"
      workflowPath: string
      triggerNodeId: string
      request: RequestEnvelope
    }
  | { type: "continue" }
  | { type: "step" }
  | { type: "step-over" }
  | { type: "replay" }
  | { type: "stop" }

export type ServerMessage =
  | { type: "ready"; sessionId: string }
  | { type: "event"; runId: string; event: LifecycleEvent; offsetMs: number }
  | {
      type: "paused"
      runId: string
      nodeId: string
      phase: "before" | "after"
      payload: unknown
    }
  | { type: "resumed"; runId: string }
  | {
      type: "run-complete"
      runId: string
      status: number
      body: unknown
      totalMs: number
    }
  | { type: "run-error"; runId: string; nodeId?: string; message: string }
  | { type: "ack"; for: ClientMessage["type"] }
```

- [ ] **Step 2: Verify the file typechecks**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime typecheck 2>&1 | tail -10
```

Expected: clean (no errors). The file is types-only so there's nothing to test functionally.

- [ ] **Step 3: Commit**

```bash
git add packages/runtime/src/dev-server/debug-protocol.ts
git commit -m "feat(runtime): debug WS protocol types

Wire types only (no logic) for the debugger WebSocket protocol.
Client/server message envelopes, Breakpoint shape, RequestEnvelope.
Consumed by the upcoming DebugSession and the IDE-side debug store.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `DebugSession` — state machine and command handlers

**Files:**
- Create: `packages/runtime/src/dev-server/debug-session.ts`
- Create: `packages/runtime/src/dev-server/debug-session.test.ts`

This task covers the state model and protocol handlers EXCEPT `buildHooks` (Task 5) and the `fire` workflow integration (Task 6).

- [ ] **Step 1: Write the failing tests**

`packages/runtime/src/dev-server/debug-session.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { DebugSession } from "./debug-session.js"
import type { Breakpoint, ServerMessage } from "./debug-protocol.js"

// Minimal mock client capturing broadcast messages
function makeMockClient() {
  const sent: ServerMessage[] = []
  const ws = {
    send: (data: string) => {
      sent.push(JSON.parse(data) as ServerMessage)
    },
    readyState: 1, // OPEN
    OPEN: 1,
  } as unknown as import("ws").WebSocket
  return { ws, sent }
}

describe("DebugSession — state + commands", () => {
  // The session needs workspace lookups for the `fire` command (workflows,
  // services, resolveNode). For Task 4 (no fire yet), we pass stub deps that
  // throw if `fire` actually attempts a run — none of these tests do.
  function makeSession() {
    return new DebugSession({
      getWorkflow: () => null, // not used in this task's tests
      getServices: async () => ({}),
      resolveNode: () => null,
    })
  }

  it("connect/disconnect tracks clients", () => {
    const session = makeSession()
    const a = makeMockClient()
    const b = makeMockClient()
    session.connect(a.ws)
    session.connect(b.ws)
    expect(session.clientCount).toBe(2)
    session.disconnect(a.ws)
    expect(session.clientCount).toBe(1)
  })

  it("hello replaces breakpoints and emits ready", async () => {
    const session = makeSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    const bps: Breakpoint[] = [
      { workflowPath: "workflows/a.workflow", nodeId: "n1", kind: "before" },
    ]
    await session.onMessage(ws, { type: "hello", breakpoints: bps })
    expect(sent.some((m) => m.type === "ready")).toBe(true)
    expect(session.getBreakpoints("workflows/a.workflow")).toEqual(bps)
  })

  it("set-breakpoints fully replaces per workflow path", async () => {
    const session = makeSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [
        { workflowPath: "a", nodeId: "n1", kind: "before" },
        { workflowPath: "b", nodeId: "n2", kind: "after" },
      ],
    })
    await session.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "a", nodeId: "n9", kind: "before" }],
    })
    expect(session.getBreakpoints("a")).toEqual([
      { workflowPath: "a", nodeId: "n9", kind: "before" },
    ])
    expect(session.getBreakpoints("b")).toEqual([])
  })

  it("continue resolves activePause and broadcasts resumed", async () => {
    const session = makeSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    // Simulate an active pause directly through the test-only setter
    let resolved = false
    session._setActivePauseForTest({
      runId: "r1",
      resolve: () => {
        resolved = true
      },
      reject: () => {},
    })
    session.setActiveRunForTest({ runId: "r1" })
    await session.onMessage(ws, { type: "continue" })
    expect(resolved).toBe(true)
    expect(sent.some((m) => m.type === "resumed" && m.runId === "r1")).toBe(true)
  })

  it("continue with no active pause is a no-op", async () => {
    const session = makeSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, { type: "continue" })
    expect(sent.some((m) => m.type === "resumed")).toBe(false)
  })

  it("step sets stepMode to 'step' and resolves any active pause", async () => {
    const session = makeSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    session._setActivePauseForTest({
      runId: "r1",
      resolve: () => {},
      reject: () => {},
    })
    session.setActiveRunForTest({ runId: "r1" })
    await session.onMessage(ws, { type: "step" })
    expect(session.stepMode).toBe("step")
  })

  it("step-over sets stepOverNodeId from current pause frame", async () => {
    const session = makeSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    session._setActivePauseForTest({
      runId: "r1",
      resolve: () => {},
      reject: () => {},
    })
    session.setActiveRunForTest({ runId: "r1" })
    session._setPauseFrameForTest({
      runId: "r1",
      nodeId: "parseBody",
      phase: "before",
    })
    await session.onMessage(ws, { type: "step-over" })
    expect(session.stepMode).toBe("step-over")
    expect(session.stepOverNodeId).toBe("parseBody")
  })

  it("step-over from after-pause is a no-op (only meaningful from before)", async () => {
    const session = makeSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    session._setActivePauseForTest({
      runId: "r1",
      resolve: () => {},
      reject: () => {},
    })
    session.setActiveRunForTest({ runId: "r1" })
    session._setPauseFrameForTest({
      runId: "r1",
      nodeId: "parseBody",
      phase: "after",
    })
    await session.onMessage(ws, { type: "step-over" })
    expect(session.stepMode).toBe("none")
    expect(session.stepOverNodeId).toBeNull()
  })

  it("stop rejects activePause with AbortError", async () => {
    const session = makeSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    let rejection: unknown = null
    session._setActivePauseForTest({
      runId: "r1",
      resolve: () => {},
      reject: (e) => {
        rejection = e
      },
    })
    session.setActiveRunForTest({ runId: "r1" })
    await session.onMessage(ws, { type: "stop" })
    expect((rejection as Error).name).toBe("AbortError")
  })

  it("disconnect rejects activePause if last client leaves", () => {
    const session = makeSession()
    const a = makeMockClient()
    session.connect(a.ws)
    let rejection: unknown = null
    session._setActivePauseForTest({
      runId: "r1",
      resolve: () => {},
      reject: (e) => {
        rejection = e
      },
    })
    session.setActiveRunForTest({ runId: "r1" })
    session.disconnect(a.ws)
    expect((rejection as Error).name).toBe("AbortError")
  })
})
```

- [ ] **Step 2: Run to verify FAIL (module doesn't exist)**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test debug-session -- --run 2>&1 | tail -10
```

Expected: FAIL (cannot resolve `./debug-session.js`).

- [ ] **Step 3: Implement `DebugSession` (state machine + command handlers)**

```ts
// packages/runtime/src/dev-server/debug-session.ts
import type { WebSocket } from "ws"
import type {
  Breakpoint,
  ClientMessage,
  ServerMessage,
} from "./debug-protocol.js"
import type { AnyNodeOrTrigger, Services } from "../types.js"
import type { LoadedWorkflow } from "./load.js"

export interface DebugSessionDeps {
  /** Look up a loaded workflow by its workspace-relative path. */
  getWorkflow: (workflowPath: string) => LoadedWorkflow | null
  /** Resolve services for a new run (factory pattern from createServiceResolver). */
  getServices: (ctx: { requestId: string; timestamp: number }) => Promise<Services>
  /** Resolve a node module by `uses` string. */
  resolveNode: (uses: string) => AnyNodeOrTrigger | null
}

interface ActivePause {
  runId: string
  resolve: () => void
  reject: (err: Error) => void
}

interface ActiveRun {
  runId: string
  workflowPath?: string
  triggerNodeId?: string
  startedAt?: number
  // Set by Task 6 (`fire` command).
  lastRequest?: import("./debug-protocol.js").RequestEnvelope
}

interface PauseFrame {
  runId: string
  nodeId: string
  phase: "before" | "after"
}

class AbortError extends Error {
  override name = "AbortError"
}

export class DebugSession {
  private breakpoints = new Map<string, Breakpoint[]>()
  private clients = new Set<WebSocket>()
  private activeRun: ActiveRun | null = null
  private activePause: ActivePause | null = null
  private pauseFrame: PauseFrame | null = null
  stepMode: "none" | "step" | "step-over" = "none"
  stepOverNodeId: string | null = null

  constructor(private deps: DebugSessionDeps) {}

  get clientCount(): number {
    return this.clients.size
  }

  getBreakpoints(workflowPath: string): Breakpoint[] {
    return this.breakpoints.get(workflowPath) ?? []
  }

  connect(ws: WebSocket): void {
    this.clients.add(ws)
  }

  disconnect(ws: WebSocket): void {
    this.clients.delete(ws)
    if (this.clients.size === 0 && this.activePause) {
      this.activePause.reject(new AbortError("client disconnected"))
      this.activePause = null
      this.pauseFrame = null
      this.activeRun = null
    }
  }

  broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg)
    for (const ws of this.clients) {
      try {
        ws.send(payload)
      } catch {
        /* dead socket — ignore; close handler will remove it */
      }
    }
  }

  async onMessage(ws: WebSocket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "hello":
        this.applyBreakpoints(msg.breakpoints)
        // Send `ready` only to the connecting client. Use direct send for that.
        ws.send(
          JSON.stringify({
            type: "ready",
            sessionId: this.makeSessionId(),
          } satisfies ServerMessage),
        )
        return
      case "set-breakpoints":
        this.applyBreakpoints(msg.breakpoints)
        ws.send(JSON.stringify({ type: "ack", for: "set-breakpoints" } satisfies ServerMessage))
        return
      case "continue":
        if (this.activePause) {
          const runId = this.activePause.runId
          this.activePause.resolve()
          this.activePause = null
          this.pauseFrame = null
          this.broadcast({ type: "resumed", runId })
        }
        return
      case "step":
        if (this.activePause) {
          this.stepMode = "step"
          const runId = this.activePause.runId
          this.activePause.resolve()
          this.activePause = null
          this.pauseFrame = null
          this.broadcast({ type: "resumed", runId })
        }
        return
      case "step-over":
        if (this.activePause && this.pauseFrame?.phase === "before") {
          this.stepMode = "step-over"
          this.stepOverNodeId = this.pauseFrame.nodeId
          const runId = this.activePause.runId
          this.activePause.resolve()
          this.activePause = null
          this.pauseFrame = null
          this.broadcast({ type: "resumed", runId })
        }
        return
      case "replay":
        // Implemented in Task 6 alongside `fire`. For now, ack only.
        ws.send(JSON.stringify({ type: "ack", for: "replay" } satisfies ServerMessage))
        return
      case "fire":
        // Implemented in Task 6.
        ws.send(JSON.stringify({ type: "ack", for: "fire" } satisfies ServerMessage))
        return
      case "stop":
        if (this.activePause) {
          this.activePause.reject(new AbortError("stopped"))
          this.activePause = null
          this.pauseFrame = null
        }
        return
    }
  }

  // Per-workflow-path full replace per spec §4.2 ("hello" + "set-breakpoints").
  private applyBreakpoints(next: Breakpoint[]): void {
    this.breakpoints.clear()
    for (const bp of next) {
      const list = this.breakpoints.get(bp.workflowPath) ?? []
      list.push(bp)
      this.breakpoints.set(bp.workflowPath, list)
    }
  }

  private makeSessionId(): string {
    return `s-${Math.random().toString(36).slice(2, 10)}`
  }

  // ── Test-only seam helpers (Task 4) ────────────────────────────────────
  // Tasks 5 and 6 use the real flow via buildHooks() + fire(); the helpers
  // below let Task 4 tests exercise the command handlers without spinning up
  // a real run.
  _setActivePauseForTest(p: ActivePause | null): void {
    this.activePause = p
  }
  _setPauseFrameForTest(f: PauseFrame | null): void {
    this.pauseFrame = f
  }
  setActiveRunForTest(r: ActiveRun | null): void {
    this.activeRun = r
  }
}
```

- [ ] **Step 4: Run to verify all task-4 tests PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test debug-session -- --run 2>&1 | tail -20
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/dev-server/debug-session.ts packages/runtime/src/dev-server/debug-session.test.ts
git commit -m "feat(runtime): DebugSession state machine + protocol command handlers

Tracks connected WS clients, breakpoint registry per workflow path,
active run + active pause + step mode. Handles hello / set-breakpoints
/ continue / step / step-over / stop commands. fire and replay are
stubbed (acked) — they wire to runWorkflow in Task 6.

Last-client-disconnect rejects any in-flight pause with an AbortError,
matching the spec's session-cleanup contract.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `DebugSession.buildHooks` — pause logic

**Files:**
- Modify: `packages/runtime/src/dev-server/debug-session.ts` — add `buildHooks(workflowPath)`
- Modify: `packages/runtime/src/dev-server/debug-session.test.ts` — pause-flow tests

- [ ] **Step 1: Write failing tests for the hook pause matrix**

Append to `debug-session.test.ts`:

```ts
describe("DebugSession.buildHooks — pause matrix", () => {
  function newSession() {
    return new DebugSession({
      getWorkflow: () => null,
      getServices: async () => ({}),
      resolveNode: () => null,
    })
  }

  it("no breakpoints, no step → never pauses", async () => {
    const session = newSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    const { onBeforeNode, onAfterNode } = session.buildHooks("wf", "run-1")
    // Both should resolve immediately (no pause)
    await expect(Promise.race([
      onBeforeNode("n1", {}),
      new Promise((_, rej) => setTimeout(() => rej(new Error("hung")), 50)),
    ])).resolves.toBeUndefined()
    await expect(Promise.race([
      onAfterNode("n1", {}),
      new Promise((_, rej) => setTimeout(() => rej(new Error("hung")), 50)),
    ])).resolves.toBeUndefined()
  })

  it("before-bp on node X pauses in onBeforeNode(X)", async () => {
    const session = newSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "wf", nodeId: "X", kind: "before" }],
    })
    const { onBeforeNode } = session.buildHooks("wf", "run-1")
    const pending = onBeforeNode("X", { foo: 1 })
    // Wait a tick for the pause broadcast
    await new Promise((r) => setTimeout(r, 10))
    expect(sent.some((m) => m.type === "paused" && m.nodeId === "X" && m.phase === "before")).toBe(true)
    // Now continue
    await session.onMessage(ws, { type: "continue" })
    await pending
  })

  it("port-bp on node X pauses in onAfterNode(X)", async () => {
    const session = newSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "wf", nodeId: "X", kind: "port:foo" }],
    })
    const { onAfterNode } = session.buildHooks("wf", "run-1")
    const pending = onAfterNode("X", { foo: 1 })
    await new Promise((r) => setTimeout(r, 10))
    expect(sent.some((m) => m.type === "paused" && m.nodeId === "X" && m.phase === "after")).toBe(true)
    await session.onMessage(ws, { type: "continue" })
    await pending
  })

  it("step pauses at the very next hook call", async () => {
    const session = newSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    // Set step mode explicitly (production flow goes through `step` command + pending pause)
    session.stepMode = "step"
    const { onBeforeNode } = session.buildHooks("wf", "run-1")
    const pending = onBeforeNode("Y", {})
    await new Promise((r) => setTimeout(r, 10))
    expect(sent.some((m) => m.type === "paused" && m.nodeId === "Y")).toBe(true)
    await session.onMessage(ws, { type: "continue" })
    await pending
  })

  it("step-over of X suppresses port-bps on X, pauses at next node's before", async () => {
    const session = newSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "wf", nodeId: "X", kind: "port:p" }],
    })
    session.stepMode = "step-over"
    session.stepOverNodeId = "X"
    const { onBeforeNode, onAfterNode } = session.buildHooks("wf", "run-1")
    // onAfterNode("X", ...) should NOT pause (port-bp suppressed for X during step-over)
    await onAfterNode("X", {})
    expect(sent.some((m) => m.type === "paused" && m.nodeId === "X" && m.phase === "after")).toBe(false)
    // Next node's onBeforeNode SHOULD pause (different nodeId → step-over arms a pause)
    const pending = onBeforeNode("Y", {})
    await new Promise((r) => setTimeout(r, 10))
    expect(sent.some((m) => m.type === "paused" && m.nodeId === "Y" && m.phase === "before")).toBe(true)
    await session.onMessage(ws, { type: "continue" })
    await pending
  })

  it("on actual pause, stepMode is cleared so subsequent runs don't auto-step", async () => {
    const session = newSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    session.stepMode = "step"
    const { onBeforeNode } = session.buildHooks("wf", "run-1")
    const pending = onBeforeNode("Y", {})
    await new Promise((r) => setTimeout(r, 10))
    expect(session.stepMode).toBe("none")
    await session.onMessage(ws, { type: "continue" })
    await pending
  })
})
```

- [ ] **Step 2: Run to verify FAIL (`buildHooks` doesn't exist)**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test debug-session -- --run 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 3: Implement `buildHooks` and `pause` on `DebugSession`**

Add to `debug-session.ts`:

```ts
// Inside the DebugSession class:

buildHooks(workflowPath: string, runId: string): {
  onBeforeNode: (nodeId: string, input: Record<string, unknown>) => Promise<void>
  onAfterNode: (nodeId: string, output: Record<string, unknown>) => Promise<void>
} {
  const shouldPause = (nodeId: string, phase: "before" | "after"): boolean => {
    // `step`: pause at the very next hook call regardless of bps.
    if (this.stepMode === "step") return true
    const bps = this.breakpoints.get(workflowPath) ?? []
    if (phase === "before") {
      // step-over: when we enter a DIFFERENT node than the one being stepped
      // over, we want to pause (we've completed the stepped node).
      if (this.stepMode === "step-over" && this.stepOverNodeId !== nodeId) return true
      return bps.some((b) => b.nodeId === nodeId && b.kind === "before")
    }
    // phase === "after"
    // step-over: suppress port + after bps on the stepped-over node itself.
    if (this.stepMode === "step-over" && this.stepOverNodeId === nodeId) return false
    return bps.some(
      (b) =>
        b.nodeId === nodeId &&
        (b.kind === "after" || b.kind.startsWith("port:")),
    )
  }

  const pause = (
    nodeId: string,
    phase: "before" | "after",
    payload: unknown,
  ): Promise<void> => {
    this.broadcast({ type: "paused", runId, nodeId, phase, payload })
    this.pauseFrame = { runId, nodeId, phase }
    return new Promise<void>((resolve, reject) => {
      this.activePause = { runId, resolve, reject }
    })
  }

  return {
    onBeforeNode: async (nodeId, input) => {
      if (shouldPause(nodeId, "before")) {
        // Clear step modes on actual pause — arming another step needs an
        // explicit command from the client.
        this.stepMode = "none"
        this.stepOverNodeId = null
        await pause(nodeId, "before", input)
      }
    },
    onAfterNode: async (nodeId, output) => {
      if (shouldPause(nodeId, "after")) {
        this.stepMode = "none"
        this.stepOverNodeId = null
        await pause(nodeId, "after", output)
      }
    },
  }
}
```

- [ ] **Step 4: Run to verify all task-5 tests PASS (and task-4 still passes)**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test debug-session -- --run 2>&1 | tail -20
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/dev-server/debug-session.ts packages/runtime/src/dev-server/debug-session.test.ts
git commit -m "feat(runtime): DebugSession.buildHooks — pause matrix for breakpoints + steps

Returns onBeforeNode/onAfterNode closures suitable for runWorkflow.
Matches per-node 'before'/'after' breakpoints, port:* breakpoints in
the after hook, and three step modes (none/step/step-over). step-over
suppresses port-bps on the stepped node and pauses at the next node's
before hook. Pause broadcasts a 'paused' ServerMessage; clearing
stepMode on actual pause prevents auto-step on subsequent runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `DebugSession.fire` + `replay`

**Files:**
- Modify: `packages/runtime/src/dev-server/debug-session.ts` — implement `fire` and `replay`
- Modify: `packages/runtime/src/dev-server/debug-session.test.ts` — fire-flow integration tests

This task connects DebugSession to `runWorkflow`. The `fire` handler synthesizes trigger outputs from a `RequestEnvelope`, builds a `LifecycleEmitter` that broadcasts events to all clients, builds hooks via `buildHooks`, then calls `runWorkflow`.

- [ ] **Step 1: Write failing tests**

Append to `debug-session.test.ts`:

```ts
import { defineNode, defineTrigger } from "../define-node.js"
import { z } from "zod"
import { computeExecutionPlan } from "../exec/topology.js"
import { validateWorkflow } from "../workflow/validate.js"
import type { LoadedWorkflow } from "./load.js"

describe("DebugSession.fire — workflow integration", () => {
  // Build a tiny in-memory workflow: trigger → echo → response
  function tinyLoadedWorkflow(): LoadedWorkflow {
    const file = {
      lorien: 1 as const,
      nodes: {
        request: {
          uses: "@core/http-request" as const,
          values: { path: "/echo", method: "POST" },
        },
        echo: {
          uses: "./nodes/echo" as const,
          in: { msg: "request.body.msg" },
        },
        response: {
          uses: "@core/response" as const,
          in: { body: "echo.msg" },
        },
      },
    }
    return {
      relativePath: "workflows/echo.workflow",
      file,
    } as unknown as LoadedWorkflow
  }

  const echoNode = defineNode({
    name: "echo",
    inputs: z.object({ msg: z.string() }),
    outputs: z.object({ msg: z.string() }),
    async run({ msg }) {
      return { msg }
    },
  })

  function makeFireSession() {
    const wf = tinyLoadedWorkflow()
    return new DebugSession({
      getWorkflow: (path) => (path === wf.relativePath ? wf : null),
      getServices: async () => ({}) as never,
      resolveNode: (uses) => {
        if (uses === "./nodes/echo") return echoNode
        return null
      },
    })
  }

  it("fire runs the workflow end-to-end and emits run-complete", async () => {
    const session = makeFireSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "fire",
      workflowPath: "workflows/echo.workflow",
      triggerNodeId: "request",
      request: { method: "POST", path: "/echo", body: { msg: "hi" } },
    })
    // Wait long enough for the run to complete
    await new Promise((r) => setTimeout(r, 50))
    const complete = sent.find((m) => m.type === "run-complete")
    expect(complete).toBeTruthy()
    expect((complete as Extract<ServerMessage, { type: "run-complete" }>).body).toBe("hi")
  })

  it("fire broadcasts lifecycle events as 'event' server messages", async () => {
    const session = makeFireSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "fire",
      workflowPath: "workflows/echo.workflow",
      triggerNodeId: "request",
      request: { method: "POST", path: "/echo", body: { msg: "hi" } },
    })
    await new Promise((r) => setTimeout(r, 50))
    const events = sent.filter((m): m is Extract<ServerMessage, { type: "event" }> => m.type === "event")
    expect(events.some((e) => e.event.type === "before-node" && e.event.nodeId === "echo")).toBe(true)
    expect(events.some((e) => e.event.type === "after-node" && e.event.nodeId === "echo")).toBe(true)
  })

  it("fire while running → run-error", async () => {
    const session = makeFireSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    // Set breakpoint to pause the first run
    await session.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "workflows/echo.workflow", nodeId: "echo", kind: "before" }],
    })
    void session.onMessage(ws, {
      type: "fire",
      workflowPath: "workflows/echo.workflow",
      triggerNodeId: "request",
      request: { method: "POST", path: "/echo", body: { msg: "first" } },
    })
    await new Promise((r) => setTimeout(r, 30)) // first run is paused at echo.before
    // Now send a second fire
    await session.onMessage(ws, {
      type: "fire",
      workflowPath: "workflows/echo.workflow",
      triggerNodeId: "request",
      request: { method: "POST", path: "/echo", body: { msg: "second" } },
    })
    const err = sent.find((m) => m.type === "run-error")
    expect(err).toBeTruthy()
    expect((err as Extract<ServerMessage, { type: "run-error" }>).message).toMatch(/in flight|already running/i)
    // Clean up the first run
    await session.onMessage(ws, { type: "continue" })
  })

  it("replay re-fires the last request envelope", async () => {
    const session = makeFireSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "fire",
      workflowPath: "workflows/echo.workflow",
      triggerNodeId: "request",
      request: { method: "POST", path: "/echo", body: { msg: "first" } },
    })
    await new Promise((r) => setTimeout(r, 50))
    const firstCompletes = sent.filter((m) => m.type === "run-complete").length
    expect(firstCompletes).toBe(1)
    await session.onMessage(ws, { type: "replay" })
    await new Promise((r) => setTimeout(r, 50))
    const secondCompletes = sent.filter((m) => m.type === "run-complete").length
    expect(secondCompletes).toBe(2)
  })
})
```

- [ ] **Step 2: Run to verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test debug-session -- --run 2>&1 | tail -20
```

Expected: FAIL (fire still ACKs but doesn't run anything; run-complete never broadcasts).

- [ ] **Step 3: Replace the `fire` and `replay` stubs in `debug-session.ts`**

In the `onMessage` switch:

```ts
case "fire": {
  if (this.activeRun) {
    ws.send(
      JSON.stringify({
        type: "run-error",
        runId: this.activeRun.runId,
        message: "another run is in flight",
      } satisfies ServerMessage),
    )
    return
  }
  void this.runFire(msg.workflowPath, msg.triggerNodeId, msg.request)
  return
}
case "replay": {
  if (this.activeRun) {
    ws.send(
      JSON.stringify({
        type: "run-error",
        runId: this.activeRun.runId,
        message: "another run is in flight",
      } satisfies ServerMessage),
    )
    return
  }
  const last = this.lastRequest
  if (!last) {
    ws.send(JSON.stringify({ type: "ack", for: "replay" } satisfies ServerMessage))
    return
  }
  void this.runFire(last.workflowPath, last.triggerNodeId, last.request)
  return
}
```

Add the `lastRequest` field and the `runFire` private method to the class:

```ts
private lastRequest: {
  workflowPath: string
  triggerNodeId: string
  request: import("./debug-protocol.js").RequestEnvelope
} | null = null

private async runFire(
  workflowPath: string,
  triggerNodeId: string,
  request: import("./debug-protocol.js").RequestEnvelope,
): Promise<void> {
  // Late imports to keep the top of the file light and avoid circular deps in test setup.
  const { runWorkflow } = await import("../exec/run.js")
  const { computeExecutionPlan } = await import("../exec/topology.js")
  const { validateWorkflow } = await import("../workflow/validate.js")
  const { buildTriggerSlice, extractParams } = await import("./trigger-slice.js")
  const { LifecycleEmitter } = await import("../exec/lifecycle.js")
  const { resolveCoreNode } = await import("../core/registry.js")

  const wf = this.deps.getWorkflow(workflowPath)
  if (!wf) {
    this.broadcast({
      type: "run-error",
      runId: "n/a",
      message: `workflow not found: ${workflowPath}`,
    })
    return
  }

  const runId = `r-${Math.random().toString(36).slice(2, 10)}`
  this.activeRun = { runId, workflowPath, triggerNodeId, startedAt: Date.now() }
  this.lastRequest = { workflowPath, triggerNodeId, request }

  // Validate + project trigger slice (mirrors server.ts mountWorkflows logic)
  const { errors, depsByNode } = validateWorkflow(wf.file)
  if (errors.length > 0) {
    this.broadcast({
      type: "run-error",
      runId,
      message: `validation: ${errors.map((e) => `${e.nodeId}.${e.field}: ${e.message}`).join("; ")}`,
    })
    this.activeRun = null
    return
  }
  const projected = buildTriggerSlice(wf.file, triggerNodeId, depsByNode)
  const { depsByNode: sliceDeps } = validateWorkflow(projected)
  const plan = computeExecutionPlan(projected, sliceDeps)

  // Synthesize trigger outputs from the envelope. Path params are extracted by
  // matching the trigger's configured path template against the envelope path.
  const triggerInstance = wf.file.nodes[triggerNodeId]
  const triggerValues = (triggerInstance?.values ?? {}) as Record<string, unknown>
  const triggerPathTemplate = (triggerValues.path as string | undefined) ?? "/"
  const triggerOutputs: Record<string, unknown> = {
    body: request.body ?? null,
    params: extractParams(triggerPathTemplate, request.path),
    query: request.query ?? {},
    headers: request.headers ?? {},
    context: { requestId: runId, timestamp: Date.now() },
  }

  // Lifecycle: every event becomes a `event` server message.
  const startedAt = Date.now()
  const lifecycle = new LifecycleEmitter()
  for (const type of ["before-node", "after-node", "edge-fired", "error", "complete"] as const) {
    lifecycle.on(type, (ev) => {
      this.broadcast({
        type: "event",
        runId,
        event: ev as never,
        offsetMs: Date.now() - startedAt,
      })
    })
  }

  // Services resolved per-run via the deps factory.
  const services = await this.deps.getServices({ requestId: runId, timestamp: Date.now() })

  // Build the pause hooks.
  const { onBeforeNode, onAfterNode } = this.buildHooks(workflowPath, runId)

  try {
    const result = await runWorkflow({
      workflow: projected,
      plan,
      triggerNodeId,
      triggerOutputs,
      services,
      resolveNode: (uses) => resolveCoreNode(uses) ?? this.deps.resolveNode(uses) ?? null,
      lifecycle,
      onBeforeNode,
      onAfterNode,
    })
    this.broadcast({
      type: "run-complete",
      runId,
      status: result.status,
      body: result.body,
      totalMs: Date.now() - startedAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const nodeId =
      err && typeof err === "object" && "nodeId" in err
        ? ((err as { nodeId: unknown }).nodeId as string | undefined)
        : undefined
    this.broadcast({
      type: "run-error",
      runId,
      ...(nodeId !== undefined ? { nodeId } : {}),
      message,
    })
  } finally {
    this.activeRun = null
    this.activePause = null
    this.pauseFrame = null
    this.stepMode = "none"
    this.stepOverNodeId = null
  }
}
```

- [ ] **Step 4: Run to verify all task-6 tests PASS (and earlier tests still green)**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test debug-session -- --run 2>&1 | tail -30
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/dev-server/debug-session.ts packages/runtime/src/dev-server/debug-session.test.ts
git commit -m "feat(runtime): DebugSession.fire + replay end-to-end against runWorkflow

fire synthesizes trigger outputs from a RequestEnvelope, projects the
trigger slice via buildTriggerSlice, builds hooks via buildHooks, and
calls runWorkflow with a LifecycleEmitter that broadcasts every event
as a 'event' server message. On resolve/reject, broadcasts
run-complete or run-error. Records the envelope for replay.

A second fire while a run is in flight responds with run-error rather
than overlapping.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `attachDebugWebSocket` — WS adapter

**Files:**
- Create: `packages/runtime/src/dev-server/debug-ws.ts`
- Create: `packages/runtime/src/dev-server/debug-ws.test.ts`
- Modify: `packages/runtime/src/index.ts` — re-exports

Mirror the pattern in `packages/runtime/src/agent-broker/server.ts` (lines 84-325) for `attachAgentBroker`.

- [ ] **Step 1: Write failing tests**

`packages/runtime/src/dev-server/debug-ws.test.ts`:

```ts
import { createServer, type Server as HttpServer } from "node:http"
import { describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { Hono } from "hono"
import { DebugSession } from "./debug-session.js"
import { attachDebugWebSocket } from "./debug-ws.js"

function startEphemeral(): Promise<{ server: HttpServer; port: number; app: Hono }> {
  const app = new Hono()
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      // Hono integration for plain Node http
      const url = `http://${req.headers.host}${req.url ?? "/"}`
      const r = await app.fetch(new Request(url, { method: req.method ?? "GET" }))
      res.writeHead(r.status)
      res.end(await r.text())
    })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({ server, port, app })
    })
  })
}

describe("attachDebugWebSocket", () => {
  it("upgrades on /__lorien/debug/ws and routes hello → ready", async () => {
    const { server, port, app } = await startEphemeral()
    const session = new DebugSession({
      getWorkflow: () => null,
      getServices: async () => ({}) as never,
      resolveNode: () => null,
    })
    attachDebugWebSocket({ app, server, session })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/__lorien/debug/ws`, {
      headers: { origin: "http://localhost:5173" },
    })
    const ready = await new Promise<unknown>((resolve, reject) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "hello", breakpoints: [] }))
      })
      ws.on("message", (data) => resolve(JSON.parse(data.toString())))
      ws.on("error", reject)
      setTimeout(() => reject(new Error("timeout")), 1000)
    })
    expect((ready as { type: string }).type).toBe("ready")
    ws.close()
    server.close()
  })

  it("rejects non-loopback origins on upgrade", async () => {
    const { server, port, app } = await startEphemeral()
    const session = new DebugSession({
      getWorkflow: () => null,
      getServices: async () => ({}) as never,
      resolveNode: () => null,
    })
    attachDebugWebSocket({ app, server, session })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/__lorien/debug/ws`, {
      headers: { origin: "http://evil.example.com" },
    })
    await new Promise<void>((resolve) => {
      ws.on("error", () => resolve())
      ws.on("unexpected-response", () => resolve())
    })
    server.close()
  })
})
```

- [ ] **Step 2: Run to verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test debug-ws -- --run 2>&1 | tail -20
```

Expected: FAIL — `attachDebugWebSocket` doesn't exist.

- [ ] **Step 3: Implement `debug-ws.ts`**

Mirror the structure of `attachAgentBroker` exactly:

```ts
// packages/runtime/src/dev-server/debug-ws.ts
import type { Server as HttpServer, IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import type { Hono } from "hono"
import { WebSocketServer, type WebSocket } from "ws"
import type { DebugSession } from "./debug-session.js"
import type { ClientMessage } from "./debug-protocol.js"

const WS_PATH = "/__lorien/debug/ws"

function isLoopbackOriginString(origin: string | undefined | null): boolean {
  if (!origin) return false
  try {
    const u = new URL(origin)
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "[::1]"
    )
  } catch {
    return false
  }
}

export interface AttachDebugWebSocketOptions {
  /** Same Hono app passed to mountWorkflows; reserved for future REST endpoints. */
  app: Hono
  /** Node HTTP server (returned by @hono/node-server's `serve`). */
  server: HttpServer
  /** The DebugSession to wire to. */
  session: DebugSession
}

export function attachDebugWebSocket(opts: AttachDebugWebSocketOptions): void {
  const wss = new WebSocketServer({ noServer: true })

  opts.server.on(
    "upgrade",
    (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!req.url || !req.url.startsWith(WS_PATH)) return
      const origin = req.headers.origin
      if (!isLoopbackOriginString(origin)) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req)
      })
    },
  )

  wss.on("connection", (ws: WebSocket) => {
    opts.session.connect(ws)
    ws.on("message", (raw) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage
      } catch {
        return
      }
      void opts.session.onMessage(ws, msg)
    })
    ws.on("close", () => opts.session.disconnect(ws))
    ws.on("error", () => opts.session.disconnect(ws))
  })
}
```

- [ ] **Step 4: Re-export from runtime root**

In `packages/runtime/src/index.ts`, add:

```ts
export { attachDebugWebSocket } from "./dev-server/debug-ws.js"
export { DebugSession } from "./dev-server/debug-session.js"
export type {
  Breakpoint,
  ClientMessage,
  ServerMessage,
  RequestEnvelope,
} from "./dev-server/debug-protocol.js"
```

- [ ] **Step 5: Run to verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test debug-ws -- --run 2>&1 | tail -20
```

Expected: green.

- [ ] **Step 6: Run full runtime test suite + typecheck**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test 2>&1 | tail -15 && pnpm --filter @darrylondil/lorien-runtime typecheck 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/dev-server/debug-ws.ts packages/runtime/src/dev-server/debug-ws.test.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): attachDebugWebSocket — Hono/ws upgrade adapter

Mounts /__lorien/debug/ws as a WebSocket endpoint. Mirrors the
attachAgentBroker pattern (server.on('upgrade', ...) + WebSocketServer
in noServer mode). Loopback-origin guard rejects non-localhost
upgrades. Each connection is registered with the shared DebugSession;
inbound messages are JSON-parsed and routed to session.onMessage.

Re-exports DebugSession + protocol types from the package root.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire `DebugSession` into the `ide` dev command

**Files:**
- Modify: `packages/build/src/commands/ide.ts` — instantiate `DebugSession` and call `attachDebugWebSocket` after `serve()`

The current ide.ts builds the Hono app via `startLorienServer` (or its own composition — read the file first) and calls `serve(...)` around line 310, then `attachAgentBroker({app, server, projectRoot})` around line 322. Add an `attachDebugWebSocket({app, server, session})` call right after.

- [ ] **Step 1: Read ide.ts to understand the current shape**

Read `packages/build/src/commands/ide.ts` (442 lines). Locate:
- Where workflows + services + the node registry are constructed/loaded
- The `serve(...)` call (~line 310)
- The `attachAgentBroker(...)` call (~line 322)

The goal: build a `DebugSessionDeps` object that points at the same loaded workflows, services, and nodes the dev server uses for real HTTP traffic.

- [ ] **Step 2: Construct `DebugSession` after workflows and services are loaded**

Locate where `mountWorkflows` is called or where the workflow array + services + nodes registry are in scope. After that, but before `serve(...)`:

```ts
import { DebugSession, attachDebugWebSocket } from "@darrylondil/lorien-runtime"

// ... existing code that loads `workflows`, `services`, and `nodes` ...

const debugSession = new DebugSession({
  getWorkflow: (workflowPath) =>
    workflows.find((w) => w.relativePath === workflowPath) ?? null,
  getServices: async (ctx) => {
    // The dev server already resolves services per-request via createServiceResolver.
    // Mirror that here. If the existing flow stores the service resolver, call it.
    // Otherwise: reuse `services` directly (singleton-style). Pick what matches
    // the existing pattern in ide.ts.
    return services
  },
  resolveNode: (uses) => nodes[uses] ?? null,
})
```

NOTE: the implementer must inspect the existing ide.ts to choose the right `getServices` strategy. If service factories are honored on real traffic, use the same code path. If services are pre-resolved singletons, just return them.

- [ ] **Step 3: Call `attachDebugWebSocket` after `serve(...)`**

Right after the existing `attachAgentBroker({ app, server, projectRoot: workspaceRoot })` line:

```ts
attachDebugWebSocket({ app, server, session: debugSession })
```

- [ ] **Step 4: Run the ide command tests to confirm nothing broke**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-build test ide -- --run 2>&1 | tail -20
```

Expected: green. (No new test is required for the wiring; the runtime-side debug-ws.test.ts covers protocol behavior, and ide.ts tests don't typically integration-test the real WS.)

- [ ] **Step 5: Run the full build test suite + typecheck**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-build test 2>&1 | tail -15 && pnpm --filter @darrylondil/lorien-build typecheck 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/build/src/commands/ide.ts
git commit -m "feat(build): wire DebugSession into the IDE dev command

DebugSession is instantiated with deps pointing at the same loaded
workflows, services, and nodes that mountWorkflows uses. After serve()
returns the Node HTTP server, attachDebugWebSocket binds the WS path
/__lorien/debug/ws. Real HTTP traffic is untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: IDE — breakpoints localStorage helpers

**Files:**
- Create: `packages/ide/src/store/debug-breakpoints-storage.ts`
- Create: `packages/ide/src/store/debug-breakpoints-storage.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/ide/src/store/debug-breakpoints-storage.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  loadBreakpoints,
  saveBreakpoints,
  STORAGE_KEY,
} from "./debug-breakpoints-storage"
import type { Breakpoint } from "@darrylondil/lorien-runtime"

describe("debug-breakpoints-storage", () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it("loadBreakpoints returns [] when no entry exists", () => {
    expect(loadBreakpoints()).toEqual([])
  })

  it("round-trips a breakpoint array", () => {
    const bps: Breakpoint[] = [
      { workflowPath: "workflows/a.workflow", nodeId: "n1", kind: "before" },
      { workflowPath: "workflows/b.workflow", nodeId: "n2", kind: "port:foo" },
    ]
    saveBreakpoints(bps)
    expect(loadBreakpoints()).toEqual(bps)
  })

  it("returns [] when localStorage contains malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not json")
    expect(loadBreakpoints()).toEqual([])
  })

  it("returns [] when entry is the wrong shape", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: "bar" }))
    expect(loadBreakpoints()).toEqual([])
  })
})
```

- [ ] **Step 2: Verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test debug-breakpoints-storage -- --run 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/ide/src/store/debug-breakpoints-storage.ts
import type { Breakpoint } from "@darrylondil/lorien-runtime"

export const STORAGE_KEY = "lorien-debug-breakpoints"

export function loadBreakpoints(): Breakpoint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (b): b is Breakpoint =>
        b != null &&
        typeof b === "object" &&
        typeof (b as Breakpoint).workflowPath === "string" &&
        typeof (b as Breakpoint).nodeId === "string" &&
        typeof (b as Breakpoint).kind === "string",
    )
  } catch {
    return []
  }
}

export function saveBreakpoints(bps: Breakpoint[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bps))
  } catch {
    /* private-mode / quota — swallow */
  }
}
```

- [ ] **Step 4: Verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test debug-breakpoints-storage -- --run 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/ide/src/store/debug-breakpoints-storage.ts packages/ide/src/store/debug-breakpoints-storage.test.ts
git commit -m "feat(ide): localStorage helpers for debug breakpoints

Single JSON blob keyed by 'lorien-debug-breakpoints' contains all
Breakpoint[] across workflows. Defensive parsing: malformed entries
and shape mismatches return [] rather than throwing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: IDE — `debug-session` Zustand store

**Files:**
- Create: `packages/ide/src/store/debug-session.ts`
- Create: `packages/ide/src/store/debug-session.test.ts`

The store is the IDE-side mirror of the spec's §5.5 model. It accepts inbound `ServerMessage`s via `applyMessage`, exposes typed actions for outgoing intent (toggle breakpoint, set request form), and is read by all Run-tab components and the canvas.

- [ ] **Step 1: Write failing tests**

```ts
// packages/ide/src/store/debug-session.test.ts
import { afterEach, describe, expect, it } from "vitest"
import { useDebugSessionStore } from "./debug-session"
import type {
  Breakpoint,
  ServerMessage,
} from "@darrylondil/lorien-runtime"

describe("useDebugSessionStore", () => {
  afterEach(() => {
    useDebugSessionStore.setState(useDebugSessionStore.getInitialState())
    localStorage.clear()
  })

  it("starts idle with no runs", () => {
    const s = useDebugSessionStore.getState()
    expect(s.status).toBe("idle")
    expect(s.runs).toEqual([])
    expect(s.selectedRunId).toBeNull()
    expect(s.pausedFrame).toBeNull()
    expect(s.breakpoints).toEqual([])
  })

  it("applies a 'ready' message and marks connected", () => {
    useDebugSessionStore.getState().applyMessage({ type: "ready", sessionId: "s-1" })
    expect(useDebugSessionStore.getState().connected).toBe(true)
  })

  it("event of type before-node sets node status to 'running' and status to 'running'", () => {
    useDebugSessionStore.getState().applyMessage({
      type: "event",
      runId: "r1",
      offsetMs: 0,
      event: { type: "before-node", nodeId: "parseBody", input: {} },
    })
    const s = useDebugSessionStore.getState()
    expect(s.status).toBe("running")
    expect(s.nodeStatuses.get("parseBody")).toBe("running")
  })

  it("event of type after-node sets node status to 'completed'", () => {
    useDebugSessionStore.getState().applyMessage({
      type: "event",
      runId: "r1",
      offsetMs: 12,
      event: { type: "after-node", nodeId: "parseBody", output: {}, durationMs: 12 },
    })
    expect(useDebugSessionStore.getState().nodeStatuses.get("parseBody")).toBe("completed")
  })

  it("event of type error sets node status to 'errored' and status to 'errored'", () => {
    useDebugSessionStore.getState().applyMessage({
      type: "event",
      runId: "r1",
      offsetMs: 0,
      event: { type: "error", nodeId: "saveUser", error: new Error("boom") },
    })
    const s = useDebugSessionStore.getState()
    expect(s.nodeStatuses.get("saveUser")).toBe("errored")
    expect(s.status).toBe("errored")
  })

  it("paused message sets status='paused' and pausedFrame", () => {
    useDebugSessionStore.getState().applyMessage({
      type: "paused",
      runId: "r1",
      nodeId: "saveUser",
      phase: "before",
      payload: { x: 1 },
    })
    const s = useDebugSessionStore.getState()
    expect(s.status).toBe("paused")
    expect(s.pausedFrame).toEqual({
      runId: "r1",
      nodeId: "saveUser",
      phase: "before",
      payload: { x: 1 },
    })
    expect(s.nodeStatuses.get("saveUser")).toBe("paused")
  })

  it("resumed message clears pausedFrame, restores 'running'", () => {
    const store = useDebugSessionStore.getState()
    store.applyMessage({
      type: "paused",
      runId: "r1",
      nodeId: "x",
      phase: "before",
      payload: null,
    })
    store.applyMessage({ type: "resumed", runId: "r1" })
    const s = useDebugSessionStore.getState()
    expect(s.pausedFrame).toBeNull()
    expect(s.status).toBe("running")
  })

  it("run-complete sets status='completed' and snapshots the run record", () => {
    const store = useDebugSessionStore.getState()
    store.beginRun("r1", "workflows/echo.workflow", "request", {
      method: "POST",
      path: "/echo",
      body: {},
    })
    store.applyMessage({
      type: "run-complete",
      runId: "r1",
      status: 200,
      body: { ok: true },
      totalMs: 42,
    })
    const s = useDebugSessionStore.getState()
    expect(s.status).toBe("completed")
    expect(s.runs[0]?.runId).toBe("r1")
    expect(s.runs[0]?.outcome).toEqual({
      kind: "ok",
      status: 200,
      body: { ok: true },
      totalMs: 42,
    })
  })

  it("retains at most the last 10 runs", () => {
    const store = useDebugSessionStore.getState()
    for (let i = 0; i < 12; i++) {
      store.beginRun(`r${i}`, "wf", "trig", { method: "GET", path: "/" })
      store.applyMessage({
        type: "run-complete",
        runId: `r${i}`,
        status: 200,
        body: null,
        totalMs: 1,
      })
    }
    const runs = useDebugSessionStore.getState().runs
    expect(runs.length).toBe(10)
    // Most recent first
    expect(runs[0]?.runId).toBe("r11")
  })

  it("toggleBreakpoint adds and removes; mirrors to localStorage", () => {
    const bp: Breakpoint = {
      workflowPath: "workflows/a.workflow",
      nodeId: "n1",
      kind: "before",
    }
    useDebugSessionStore.getState().toggleBreakpoint(bp)
    expect(useDebugSessionStore.getState().breakpoints).toContainEqual(bp)
    const raw = localStorage.getItem("lorien-debug-breakpoints")
    expect(raw).toBeTruthy()
    useDebugSessionStore.getState().toggleBreakpoint(bp)
    expect(useDebugSessionStore.getState().breakpoints).not.toContainEqual(bp)
  })

  it("hydrateBreakpoints loads from localStorage", () => {
    const bp: Breakpoint = {
      workflowPath: "workflows/a.workflow",
      nodeId: "n1",
      kind: "before",
    }
    localStorage.setItem("lorien-debug-breakpoints", JSON.stringify([bp]))
    useDebugSessionStore.getState().hydrateBreakpoints()
    expect(useDebugSessionStore.getState().breakpoints).toEqual([bp])
  })
})
```

- [ ] **Step 2: Verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test debug-session -- --run 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 3: Implement the store**

```ts
// packages/ide/src/store/debug-session.ts
import { create } from "zustand"
import type {
  Breakpoint,
  RequestEnvelope,
  ServerMessage,
} from "@darrylondil/lorien-runtime"
import {
  loadBreakpoints,
  saveBreakpoints,
} from "./debug-breakpoints-storage"

export type RunStatus = "idle" | "running" | "paused" | "completed" | "errored"
export type NodeStatus = "running" | "completed" | "errored" | "paused"

export interface TimelineEvent {
  offsetMs: number
  event:
    | { type: "before-node"; nodeId: string; input: Record<string, unknown> }
    | { type: "after-node"; nodeId: string; output: Record<string, unknown>; durationMs: number }
    | { type: "edge-fired"; from: string; to: string; value: unknown }
    | { type: "error"; nodeId: string; error: Error }
    | { type: "complete"; totalMs: number }
}

export interface RunRecord {
  runId: string
  workflowPath: string
  triggerNodeId: string
  request: RequestEnvelope
  startedAt: number
  events: TimelineEvent[]
  outcome:
    | { kind: "ok"; status: number; body: unknown; totalMs: number }
    | { kind: "err"; nodeId?: string; message: string }
    | { kind: "running" }
}

export interface PausedFrame {
  runId: string
  nodeId: string
  phase: "before" | "after"
  payload: unknown
}

interface DebugSessionState {
  connected: boolean
  status: RunStatus
  runs: RunRecord[] // most-recent first; cap at 10
  selectedRunId: string | null
  pausedFrame: PausedFrame | null
  nodeStatuses: Map<string, NodeStatus>
  breakpoints: Breakpoint[]
  requestForm: {
    triggerNodeId: string | null
    method: string
    path: string
    body: string // raw JSON text (validated on Send)
    query: Array<[string, string]>
    headers: Array<[string, string]>
  }

  // intents
  setConnected: (v: boolean) => void
  beginRun: (
    runId: string,
    workflowPath: string,
    triggerNodeId: string,
    request: RequestEnvelope,
  ) => void
  applyMessage: (msg: ServerMessage) => void
  selectRun: (runId: string) => void
  toggleBreakpoint: (bp: Breakpoint) => void
  setBreakpoints: (bps: Breakpoint[]) => void
  hydrateBreakpoints: () => void
  setRequestForm: (
    updater: (cur: DebugSessionState["requestForm"]) => DebugSessionState["requestForm"],
  ) => void
}

const initialRequestForm: DebugSessionState["requestForm"] = {
  triggerNodeId: null,
  method: "GET",
  path: "/",
  body: "",
  query: [],
  headers: [],
}

export const useDebugSessionStore = create<DebugSessionState>((set, get) => ({
  connected: false,
  status: "idle",
  runs: [],
  selectedRunId: null,
  pausedFrame: null,
  nodeStatuses: new Map(),
  breakpoints: [],
  requestForm: initialRequestForm,

  setConnected: (v) => set({ connected: v }),

  beginRun: (runId, workflowPath, triggerNodeId, request) => {
    const record: RunRecord = {
      runId,
      workflowPath,
      triggerNodeId,
      request,
      startedAt: Date.now(),
      events: [],
      outcome: { kind: "running" },
    }
    set((s) => ({
      runs: [record, ...s.runs].slice(0, 10),
      selectedRunId: runId,
      status: "running",
      nodeStatuses: new Map(),
      pausedFrame: null,
    }))
  },

  applyMessage: (msg) => {
    switch (msg.type) {
      case "ready":
        set({ connected: true })
        return
      case "event": {
        const { runId, event, offsetMs } = msg
        set((s) => {
          // Append event to its run
          const runs = s.runs.map((r) =>
            r.runId === runId
              ? { ...r, events: [...r.events, { offsetMs, event } as TimelineEvent] }
              : r,
          )
          const nodeStatuses = new Map(s.nodeStatuses)
          let status = s.status
          if (event.type === "before-node") {
            nodeStatuses.set(event.nodeId, "running")
            if (status === "idle") status = "running"
          } else if (event.type === "after-node") {
            nodeStatuses.set(event.nodeId, "completed")
          } else if (event.type === "error") {
            nodeStatuses.set(event.nodeId, "errored")
            status = "errored"
          }
          return { runs, nodeStatuses, status }
        })
        return
      }
      case "paused": {
        set((s) => {
          const nodeStatuses = new Map(s.nodeStatuses)
          nodeStatuses.set(msg.nodeId, "paused")
          return {
            status: "paused",
            pausedFrame: {
              runId: msg.runId,
              nodeId: msg.nodeId,
              phase: msg.phase,
              payload: msg.payload,
            },
            nodeStatuses,
          }
        })
        return
      }
      case "resumed":
        set((s) => {
          const nodeStatuses = new Map(s.nodeStatuses)
          if (s.pausedFrame) {
            // The paused node moves back to a sensible state — running for `before`,
            // completed for `after`. The next event will overwrite as needed.
            nodeStatuses.set(
              s.pausedFrame.nodeId,
              s.pausedFrame.phase === "before" ? "running" : "completed",
            )
          }
          return { status: "running", pausedFrame: null, nodeStatuses }
        })
        return
      case "run-complete":
        set((s) => ({
          status: "completed",
          runs: s.runs.map((r) =>
            r.runId === msg.runId
              ? {
                  ...r,
                  outcome: {
                    kind: "ok",
                    status: msg.status,
                    body: msg.body,
                    totalMs: msg.totalMs,
                  },
                }
              : r,
          ),
        }))
        return
      case "run-error":
        set((s) => ({
          status: "errored",
          runs: s.runs.map((r) =>
            r.runId === msg.runId
              ? {
                  ...r,
                  outcome: {
                    kind: "err",
                    ...(msg.nodeId !== undefined ? { nodeId: msg.nodeId } : {}),
                    message: msg.message,
                  },
                }
              : r,
          ),
        }))
        return
      case "ack":
        // Acks are silent — UI doesn't reflect them.
        return
    }
  },

  selectRun: (runId) => set({ selectedRunId: runId }),

  toggleBreakpoint: (bp) =>
    set((s) => {
      const existing = s.breakpoints.findIndex(
        (b) =>
          b.workflowPath === bp.workflowPath &&
          b.nodeId === bp.nodeId &&
          b.kind === bp.kind,
      )
      const next =
        existing >= 0
          ? s.breakpoints.filter((_, i) => i !== existing)
          : [...s.breakpoints, bp]
      saveBreakpoints(next)
      return { breakpoints: next }
    }),

  setBreakpoints: (bps) => {
    saveBreakpoints(bps)
    set({ breakpoints: bps })
  },

  hydrateBreakpoints: () => set({ breakpoints: loadBreakpoints() }),

  setRequestForm: (updater) =>
    set((s) => ({ requestForm: updater(s.requestForm) })),
}))
```

- [ ] **Step 4: Verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test debug-session -- --run 2>&1 | tail -15
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/ide/src/store/debug-session.ts packages/ide/src/store/debug-session.test.ts
git commit -m "feat(ide): debug-session Zustand store

Mirrors the spec's §5.5 model. applyMessage fans out ServerMessage
events into status / nodeStatuses / runs / pausedFrame. Keeps the
last 10 runs. toggleBreakpoint mirrors to localStorage on every
change. requestForm holds the in-progress request builder state
(survives tab switches; lost on page reload by design).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `useDebugTransport` hook + `debugWsUrl()` helper

**Files:**
- Modify: `packages/ide/src/lib/api.ts` — add `debugWsUrl()` (mirror of `wsUrl()`)
- Modify: `packages/ide/src/lib/api.test.ts` — coverage for `debugWsUrl()`
- Create: `packages/ide/src/hooks/use-debug-transport.ts`
- Create: `packages/ide/src/hooks/use-debug-transport.test.tsx`

- [ ] **Step 1: Write failing tests for `debugWsUrl()`**

Add to `packages/ide/src/lib/api.test.ts` (mirroring the existing `wsUrl` tests):

```ts
describe("debugWsUrl", () => {
  it("derives ws://host:port/__lorien/debug/ws from the default REST base", () => {
    expect(debugWsUrl()).toBe("ws://localhost:3000/__lorien/debug/ws")
  })

  it("uses wss for https REST base", () => {
    vi.stubEnv("VITE_LORIEN_API_URL", "https://api.example.com")
    expect(debugWsUrl()).toBe("wss://api.example.com/__lorien/debug/ws")
  })
})
```

Also import `debugWsUrl` in that file.

- [ ] **Step 2: Verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test api.test -- --run 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 3: Add `debugWsUrl()` in `api.ts`**

Right below the existing `wsUrl()`:

```ts
export function debugWsUrl(): string {
  const base = restBase()
  const wsScheme = base.startsWith("https://") ? "wss://" : "ws://"
  const host = base.replace(/^https?:\/\//, "").replace(/\/+$/, "")
  return `${wsScheme}${host}/__lorien/debug/ws`
}
```

- [ ] **Step 4: Verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test api.test -- --run 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 5: Write failing tests for `useDebugTransport`**

```tsx
// packages/ide/src/hooks/use-debug-transport.test.tsx
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDebugSessionStore } from "../store/debug-session"
import { useDebugTransport } from "./use-debug-transport"

const sockets: Array<{
  url: string
  send: (data: string) => void
  close: () => void
  triggerOpen: () => void
  triggerMessage: (data: unknown) => void
  triggerClose: () => void
}> = []

class FakeWS {
  static instances: FakeWS[] = []
  url: string
  readyState = 0
  OPEN = 1
  onopen: (() => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  constructor(url: string) {
    this.url = url
    FakeWS.instances.push(this)
    const ref = this
    sockets.push({
      url,
      send: (d: string) => ref.sent.push(d),
      close: () => {
        ref.readyState = 3
        ref.onclose?.()
      },
      triggerOpen: () => {
        ref.readyState = 1
        ref.onopen?.()
      },
      triggerMessage: (data: unknown) => {
        ref.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }))
      },
      triggerClose: () => {
        ref.readyState = 3
        ref.onclose?.()
      },
    })
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
}

beforeEach(() => {
  sockets.length = 0
  FakeWS.instances = []
  vi.stubGlobal("WebSocket", FakeWS as never)
  useDebugSessionStore.setState(useDebugSessionStore.getInitialState())
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useDebugTransport", () => {
  it("opens a WS to debugWsUrl() and sends hello on open with current breakpoints", () => {
    useDebugSessionStore.getState().setBreakpoints([
      { workflowPath: "wf", nodeId: "n1", kind: "before" },
    ])
    // Capture FakeWS instances via a class-level static registry so the test
    // can inspect what was sent on the wire. Update FakeWS to push `this`
    // into a static `instances: FakeWS[]` array in its constructor, then:
    renderHook(() => useDebugTransport())
    const instances = (globalThis.WebSocket as unknown as { instances: FakeWS[] }).instances
    expect(instances.length).toBe(1)
    act(() => sockets[0]!.triggerOpen())
    const helloRaw = instances[0]!.sent[0]
    expect(helloRaw).toBeDefined()
    const hello = JSON.parse(helloRaw!) as { type: string; breakpoints: unknown[] }
    expect(hello.type).toBe("hello")
    expect(hello.breakpoints).toEqual([
      { workflowPath: "wf", nodeId: "n1", kind: "before" },
    ])
  })

  it("dispatches inbound 'ready' into the store", () => {
    renderHook(() => useDebugTransport())
    act(() => sockets[0]!.triggerOpen())
    act(() => sockets[0]!.triggerMessage({ type: "ready", sessionId: "s-1" }))
    expect(useDebugSessionStore.getState().connected).toBe(true)
  })
})
```

NOTE: WebSocket mocking in jsdom is finicky. If the above pattern is awkward, the implementer should either:
- Build a small `__test_inject_ws__` seam on the hook (factory injection), or
- Use a real `ws` server in the test (heavier but cleaner)

The intent is what matters: opening on mount, dispatching inbound messages into the store, sending `hello` on open with current breakpoints.

- [ ] **Step 6: Verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test use-debug-transport -- --run 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 7: Implement the hook**

```ts
// packages/ide/src/hooks/use-debug-transport.ts
import { useEffect, useRef } from "react"
import type {
  ClientMessage,
  ServerMessage,
} from "@darrylondil/lorien-runtime"
import { debugWsUrl } from "../lib/api"
import { useDebugSessionStore } from "../store/debug-session"

let singleton: { ws: WebSocket; refCount: number } | null = null

const BACKOFFS = [1000, 2000, 5000, 10_000]

export function useDebugTransport(): {
  send: (msg: ClientMessage) => void
} {
  const sendRef = useRef<(msg: ClientMessage) => void>(() => {})

  useEffect(() => {
    let cancelled = false
    let attempt = 0

    const connect = () => {
      const ws = new WebSocket(debugWsUrl())
      singleton = { ws, refCount: (singleton?.refCount ?? 0) + 1 }

      ws.onopen = () => {
        attempt = 0
        // Send hello with current breakpoints
        const bps = useDebugSessionStore.getState().breakpoints
        ws.send(JSON.stringify({ type: "hello", breakpoints: bps } satisfies ClientMessage))
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as ServerMessage
          useDebugSessionStore.getState().applyMessage(msg)
        } catch {
          /* swallow malformed payload */
        }
      }
      ws.onclose = () => {
        if (cancelled) return
        useDebugSessionStore.getState().setConnected(false)
        const wait = BACKOFFS[Math.min(attempt, BACKOFFS.length - 1)]
        attempt++
        setTimeout(connect, wait)
      }
      ws.onerror = () => {
        try {
          ws.close()
        } catch {
          /* */
        }
      }

      sendRef.current = (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
      }
    }

    // Hydrate breakpoints from localStorage before first hello
    useDebugSessionStore.getState().hydrateBreakpoints()
    connect()

    return () => {
      cancelled = true
      if (singleton) {
        singleton.refCount = Math.max(0, singleton.refCount - 1)
        if (singleton.refCount === 0) {
          try {
            singleton.ws.close()
          } catch {
            /* */
          }
          singleton = null
        }
      }
    }
  }, [])

  return {
    send: (msg) => sendRef.current(msg),
  }
}
```

- [ ] **Step 8: Verify hook tests PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test use-debug-transport -- --run 2>&1 | tail -15
```

Expected: green.

- [ ] **Step 9: Commit**

```bash
git add packages/ide/src/lib/api.ts packages/ide/src/lib/api.test.ts packages/ide/src/hooks/use-debug-transport.ts packages/ide/src/hooks/use-debug-transport.test.tsx
git commit -m "feat(ide): useDebugTransport hook + debugWsUrl helper

Single module-scope WS connection shared by any component that mounts
the hook. On open, sends hello with current localStorage breakpoints.
Inbound ServerMessages dispatch into useDebugSessionStore. Reconnect
backoff: 1s/2s/5s/10s, clamped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: `<RunTab>` skeleton + replace placeholder in Inspector

**Files:**
- Create: `packages/ide/src/panels/run-tab/index.tsx`
- Modify: `packages/ide/src/panels/inspector-panel.tsx` — swap the Run placeholder

- [ ] **Step 1: Implement a minimal `<RunTab>`**

```tsx
// packages/ide/src/panels/run-tab/index.tsx
import { useDebugTransport } from "@/hooks/use-debug-transport"
import { useDebugSessionStore } from "@/store/debug-session"

export function RunTab() {
  useDebugTransport()
  const connected = useDebugSessionStore((s) => s.connected)
  return (
    <div className="flex h-full flex-col gap-3" data-testid="run-tab">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Debugger
      </div>
      <div className="text-xs">
        Connection:{" "}
        <span className={connected ? "text-green-600" : "text-muted-foreground"}>
          {connected ? "connected" : "disconnected"}
        </span>
      </div>
      {/* TriggerSelector + RequestBuilder + StatusBanner + Timeline + RunPicker land in subsequent tasks */}
    </div>
  )
}
```

- [ ] **Step 2: Replace the Run placeholder in `inspector-panel.tsx`**

In `packages/ide/src/panels/inspector-panel.tsx`, find:

```tsx
<TabsContent value="run" className="flex-1 overflow-auto p-3">
  <PlaceholderCard title="Run" body="Request input, timeline, step controls during runs." />
</TabsContent>
```

Replace with:

```tsx
<TabsContent value="run" className="flex-1 overflow-auto p-3">
  <RunTab />
</TabsContent>
```

Add the import at the top:

```tsx
import { RunTab } from "./run-tab"
```

- [ ] **Step 3: Smoke test**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10 && pnpm --filter @darrylondil/lorien-ide test inspector-panel -- --run 2>&1 | tail -15
```

Expected: typecheck clean. If the existing inspector-panel test asserts on the placeholder, update it to expect `data-testid="run-tab"` instead (or to NOT find "Request input, timeline, step controls during runs.").

- [ ] **Step 4: Commit**

```bash
git add packages/ide/src/panels/run-tab/index.tsx packages/ide/src/panels/inspector-panel.tsx packages/ide/src/panels/inspector-panel.test.tsx
git commit -m "feat(ide): RunTab skeleton wired into Inspector

Replaces the Run-tab placeholder with a minimal component that mounts
useDebugTransport and displays connection status. Subsequent tasks
populate the rest of the UI (trigger selector, request builder, step
controls, timeline, run picker).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: `<TriggerSelector>` + `<RequestBuilder>`

**Files:**
- Create: `packages/ide/src/panels/run-tab/trigger-selector.tsx`
- Create: `packages/ide/src/panels/run-tab/request-builder.tsx`
- Modify: `packages/ide/src/panels/run-tab/index.tsx` — render the new components

- [ ] **Step 1: Implement `<TriggerSelector>`**

```tsx
// packages/ide/src/panels/run-tab/trigger-selector.tsx
import { useEffect } from "react"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useDebugSessionStore } from "@/store/debug-session"

interface Trigger {
  nodeId: string
  method: string
  path: string
}

function discoverTriggers(): Trigger[] {
  const workflow = useLiveWorkflowStore.getState().workflow
  if (!workflow) return []
  const triggers: Trigger[] = []
  for (const [nodeId, instance] of Object.entries(workflow.nodes)) {
    if (instance.uses !== "@core/http-request") continue
    const values = (instance.values ?? {}) as Record<string, unknown>
    triggers.push({
      nodeId,
      method: (values.method as string | undefined) ?? "GET",
      path: (values.path as string | undefined) ?? "/",
    })
  }
  return triggers
}

export function TriggerSelector() {
  const workflow = useLiveWorkflowStore((s) => s.workflow)
  const selected = useDebugSessionStore((s) => s.requestForm.triggerNodeId)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)

  const triggers = workflow ? discoverTriggers() : []

  // Auto-select single trigger; clear selection when triggers list changes.
  useEffect(() => {
    if (triggers.length === 0 && selected !== null) {
      setRequestForm((cur) => ({ ...cur, triggerNodeId: null }))
      return
    }
    if (triggers.length === 1 && selected !== triggers[0]!.nodeId) {
      const t = triggers[0]!
      setRequestForm(() => ({
        triggerNodeId: t.nodeId,
        method: t.method,
        path: t.path,
        body: "",
        query: [],
        headers: [],
      }))
      return
    }
    if (selected && !triggers.find((t) => t.nodeId === selected)) {
      setRequestForm((cur) => ({ ...cur, triggerNodeId: null }))
    }
  }, [triggers.length, triggers.map((t) => t.nodeId).join("|")]) // eslint-disable-line react-hooks/exhaustive-deps

  if (triggers.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        Add an <code>@core/http-request</code> node to debug this workflow.
      </div>
    )
  }
  if (triggers.length === 1) {
    return null // auto-selected; no UI
  }
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Trigger:</span>
      <select
        className="rounded-md border bg-background px-2 py-1"
        value={selected ?? ""}
        onChange={(e) => {
          const id = e.target.value
          const t = triggers.find((tr) => tr.nodeId === id)
          if (!t) return
          setRequestForm(() => ({
            triggerNodeId: t.nodeId,
            method: t.method,
            path: t.path,
            body: "",
            query: [],
            headers: [],
          }))
        }}
      >
        {triggers.map((t) => (
          <option key={t.nodeId} value={t.nodeId}>
            {t.method} {t.path}
          </option>
        ))}
      </select>
    </label>
  )
}
```

- [ ] **Step 2: Implement `<RequestBuilder>`**

```tsx
// packages/ide/src/panels/run-tab/request-builder.tsx
import { useDebugSessionStore } from "@/store/debug-session"

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

export function RequestBuilder() {
  const form = useDebugSessionStore((s) => s.requestForm)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)
  const triggerNodeId = form.triggerNodeId

  if (!triggerNodeId) {
    // TriggerSelector renders the empty-state message; we just hide here.
    return null
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex items-center gap-2">
        <select
          className="rounded-md border bg-background px-2 py-1"
          value={form.method}
          onChange={(e) => setRequestForm((c) => ({ ...c, method: e.target.value }))}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="flex-1 rounded-md border bg-background px-2 py-1 font-mono"
          value={form.path}
          onChange={(e) => setRequestForm((c) => ({ ...c, path: e.target.value }))}
        />
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">body (JSON)</span>
        <textarea
          className="h-24 rounded-md border bg-background p-2 font-mono"
          value={form.body}
          onChange={(e) => setRequestForm((c) => ({ ...c, body: e.target.value }))}
          placeholder='e.g. { "email": "a@b.com" }'
          data-testid="request-body"
        />
      </label>
      <details className="text-muted-foreground">
        <summary>headers</summary>
        <KeyValueGrid
          pairs={form.headers}
          onChange={(headers) => setRequestForm((c) => ({ ...c, headers }))}
        />
      </details>
      <details className="text-muted-foreground">
        <summary>query</summary>
        <KeyValueGrid
          pairs={form.query}
          onChange={(query) => setRequestForm((c) => ({ ...c, query }))}
        />
      </details>
    </div>
  )
}

function KeyValueGrid({
  pairs,
  onChange,
}: {
  pairs: Array<[string, string]>
  onChange: (next: Array<[string, string]>) => void
}) {
  return (
    <div className="mt-1 flex flex-col gap-1">
      {pairs.map(([k, v], i) => (
        <div key={i} className="flex gap-1">
          <input
            className="w-1/3 rounded-md border bg-background px-2 py-1 font-mono"
            value={k}
            onChange={(e) => {
              const next = [...pairs] as Array<[string, string]>
              next[i] = [e.target.value, v]
              onChange(next)
            }}
          />
          <input
            className="flex-1 rounded-md border bg-background px-2 py-1 font-mono"
            value={v}
            onChange={(e) => {
              const next = [...pairs] as Array<[string, string]>
              next[i] = [k, e.target.value]
              onChange(next)
            }}
          />
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
            aria-label="remove"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="self-start rounded-md border px-2 py-1 text-muted-foreground hover:text-foreground"
        onClick={() => onChange([...pairs, ["", ""]])}
      >
        + add
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Render the components in `<RunTab>`**

Update `packages/ide/src/panels/run-tab/index.tsx`:

```tsx
import { useDebugTransport } from "@/hooks/use-debug-transport"
import { useDebugSessionStore } from "@/store/debug-session"
import { TriggerSelector } from "./trigger-selector"
import { RequestBuilder } from "./request-builder"

export function RunTab() {
  useDebugTransport()
  const connected = useDebugSessionStore((s) => s.connected)
  return (
    <div className="flex h-full flex-col gap-3" data-testid="run-tab">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Debugger
        </div>
        <div className="text-[10px]">
          <span className={connected ? "text-green-600" : "text-muted-foreground"}>
            {connected ? "● connected" : "○ disconnected"}
          </span>
        </div>
      </div>
      <TriggerSelector />
      <RequestBuilder />
    </div>
  )
}
```

- [ ] **Step 4: Smoke test typecheck + visual render**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/ide/src/panels/run-tab/trigger-selector.tsx packages/ide/src/panels/run-tab/request-builder.tsx packages/ide/src/panels/run-tab/index.tsx
git commit -m "feat(ide): RunTab — TriggerSelector + RequestBuilder

TriggerSelector auto-selects the only http-request node when there's
one; renders a dropdown for 2+; shows an empty-state message for 0.
RequestBuilder is a method/path/body/headers/query form bound to the
debug-session store's requestForm. JSON body is a plain textarea
(validated on Send in the next task) — keeps the diff small and
avoids Monaco in this surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Send button + `<StatusBanner>` + step controls

**Files:**
- Create: `packages/ide/src/panels/run-tab/status-banner.tsx`
- Modify: `packages/ide/src/panels/run-tab/request-builder.tsx` — add Send button (or factor into a sibling)
- Modify: `packages/ide/src/panels/run-tab/index.tsx` — render the banner

- [ ] **Step 1: Implement `<StatusBanner>`**

```tsx
// packages/ide/src/panels/run-tab/status-banner.tsx
import type { ClientMessage } from "@darrylondil/lorien-runtime"
import { useDebugSessionStore } from "@/store/debug-session"

export function StatusBanner({ send }: { send: (msg: ClientMessage) => void }) {
  const status = useDebugSessionStore((s) => s.status)
  const pausedFrame = useDebugSessionStore((s) => s.pausedFrame)

  if (status === "idle") return null

  return (
    <div
      className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs"
      data-testid="status-banner"
    >
      <div>
        {status === "running" && <span>▶ Running…</span>}
        {status === "paused" && pausedFrame && (
          <span>
            ⏸ Paused at <code className="font-mono">{pausedFrame.nodeId}</code>.
            {pausedFrame.phase}
          </span>
        )}
        {status === "completed" && <span className="text-green-700">✓ Completed</span>}
        {status === "errored" && <span className="text-red-700">✕ Errored</span>}
      </div>
      <div className="flex gap-1">
        {status === "paused" && (
          <>
            <button
              type="button"
              className="rounded-md border bg-background px-2 py-1 hover:bg-accent"
              onClick={() => send({ type: "continue" })}
            >
              Continue
            </button>
            <button
              type="button"
              className="rounded-md border bg-background px-2 py-1 hover:bg-accent"
              onClick={() => send({ type: "step" })}
            >
              Step
            </button>
            {pausedFrame?.phase === "before" && (
              <button
                type="button"
                className="rounded-md border bg-background px-2 py-1 hover:bg-accent"
                onClick={() => send({ type: "step-over" })}
              >
                Step Over
              </button>
            )}
          </>
        )}
        {(status === "running" || status === "paused") && (
          <button
            type="button"
            className="rounded-md border bg-background px-2 py-1 text-red-700 hover:bg-accent"
            onClick={() => send({ type: "stop" })}
          >
            Stop
          </button>
        )}
        {(status === "completed" || status === "errored") && (
          <button
            type="button"
            className="rounded-md border bg-background px-2 py-1 hover:bg-accent"
            onClick={() => send({ type: "replay" })}
          >
            Replay
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add Send button + JSON validation**

Add a Send button at the bottom of `<RequestBuilder>` (or as a sibling component in `<RunTab>` — pick whichever keeps RequestBuilder focused). For simplicity, add it to `<RequestBuilder>`:

At the bottom of `RequestBuilder`'s JSX (just before the closing `</div>`):

```tsx
<SendButton />
```

Define `SendButton` in the same file (or a new file `send-button.tsx`):

```tsx
import { useState } from "react"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useTabsStore } from "@/store/tabs"
import { useDebugSessionStore } from "@/store/debug-session"
import { useDebugTransport } from "@/hooks/use-debug-transport"
import type { RequestEnvelope, ClientMessage } from "@darrylondil/lorien-runtime"

function SendButton() {
  const form = useDebugSessionStore((s) => s.requestForm)
  const status = useDebugSessionStore((s) => s.status)
  const beginRun = useDebugSessionStore((s) => s.beginRun)
  const liveTabId = useLiveWorkflowStore((s) => s.tabId)
  const tabs = useTabsStore((s) => s.tabs)
  const workflowPath = tabs.find((t) => t.id === liveTabId)?.path ?? ""
  const { send } = useDebugTransport()
  const [jsonError, setJsonError] = useState<string | null>(null)

  const inFlight = status === "running" || status === "paused"

  const onClick = () => {
    if (!form.triggerNodeId || !workflowPath) return
    let body: unknown = undefined
    if (form.body.trim().length > 0) {
      try {
        body = JSON.parse(form.body)
      } catch (e) {
        setJsonError((e as Error).message)
        return
      }
    }
    setJsonError(null)
    const envelope: RequestEnvelope = {
      method: form.method,
      path: form.path,
      ...(body !== undefined ? { body } : {}),
      ...(form.query.length > 0
        ? { query: Object.fromEntries(form.query.filter(([k]) => k.length > 0)) }
        : {}),
      ...(form.headers.length > 0
        ? { headers: Object.fromEntries(form.headers.filter(([k]) => k.length > 0)) }
        : {}),
    }
    const runId = `local-${Math.random().toString(36).slice(2, 8)}`
    beginRun(runId, workflowPath, form.triggerNodeId, envelope)
    send({
      type: "fire",
      workflowPath,
      triggerNodeId: form.triggerNodeId,
      request: envelope,
    } satisfies ClientMessage)
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={inFlight || !form.triggerNodeId}
        className="rounded-md border bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        onClick={onClick}
      >
        Send
      </button>
      {jsonError && <span className="text-red-700">{jsonError}</span>}
    </div>
  )
}
```

Note: `beginRun` uses a client-generated `runId` (`local-*`) so the IDE has a record to attach incoming events to. The server's actual runId will be different, so events will create a separate "remote" run record. **Bug to avoid:** the IDE's `applyMessage(event)` looks up the run by `runId` — the server's runId won't match the client-generated one. We need to reconcile.

Fix this by NOT pre-generating a client runId. Instead: the first `event` message creates the run record on the IDE side. Update `applyMessage("event", ...)` in the store to lazy-create a run record if it doesn't exist, and `beginRun` can be removed from the Send flow.

Update `applyMessage` in `debug-session.ts` (Task 10):

```ts
case "event": {
  const { runId, event, offsetMs } = msg
  set((s) => {
    // Lazy-create a run record if the runId is new
    let runs = s.runs
    if (!runs.find((r) => r.runId === runId)) {
      // We don't know workflowPath/triggerNodeId here — use the form's last-sent values
      // OR add a `pendingFire` field. Simplest: track a `lastFire` field on the store.
      const lf = s.lastFire
      const record: RunRecord = {
        runId,
        workflowPath: lf?.workflowPath ?? "",
        triggerNodeId: lf?.triggerNodeId ?? "",
        request: lf?.request ?? { method: "GET", path: "/" },
        startedAt: Date.now(),
        events: [],
        outcome: { kind: "running" },
      }
      runs = [record, ...s.runs].slice(0, 10)
    }
    runs = runs.map((r) =>
      r.runId === runId
        ? { ...r, events: [...r.events, { offsetMs, event } as TimelineEvent] }
        : r,
    )
    // ...rest unchanged
  })
}
```

And add `lastFire` to the store + a `recordFire` action; SendButton calls `recordFire` instead of `beginRun`.

Actually simpler: **remove beginRun**. Just call `recordFire(workflowPath, triggerNodeId, envelope)` which stores `lastFire` and sets `status: "running"`. The first incoming `event` triggers lazy run-record creation using `lastFire`.

Make this change to `debug-session.ts`:

```ts
// Add to state:
lastFire: { workflowPath: string; triggerNodeId: string; request: RequestEnvelope } | null

// Replace beginRun with:
recordFire: (workflowPath: string, triggerNodeId: string, request: RequestEnvelope) =>
  set({
    lastFire: { workflowPath, triggerNodeId, request },
    status: "running",
    nodeStatuses: new Map(),
    pausedFrame: null,
  }),
```

And in applyMessage("event"), lazy-create the run record from `lastFire`.

Then SendButton:

```ts
const recordFire = useDebugSessionStore((s) => s.recordFire)
// ...
recordFire(workflowPath, form.triggerNodeId, envelope)
send({ type: "fire", workflowPath, triggerNodeId: form.triggerNodeId, request: envelope })
```

- [ ] **Step 3: Update task-10 tests to cover lazy run creation**

Add to `debug-session.test.ts`:

```ts
it("event for unknown runId lazy-creates a run record from lastFire", () => {
  const store = useDebugSessionStore.getState()
  store.recordFire("workflows/a.workflow", "trig", { method: "GET", path: "/" })
  store.applyMessage({
    type: "event",
    runId: "r-server-1",
    offsetMs: 0,
    event: { type: "before-node", nodeId: "trig", input: {} },
  })
  const runs = useDebugSessionStore.getState().runs
  expect(runs[0]?.runId).toBe("r-server-1")
  expect(runs[0]?.workflowPath).toBe("workflows/a.workflow")
})
```

(Update task 10's `beginRun` test if you keep `beginRun` around for any other call sites; otherwise remove it.)

- [ ] **Step 4: Render `<StatusBanner>` in `<RunTab>`**

```tsx
import { StatusBanner } from "./status-banner"

// In the RunTab JSX, between RequestBuilder and the (upcoming) Timeline:
<StatusBanner send={send} />
```

`send` needs to come from `useDebugTransport()`. Update RunTab:

```tsx
export function RunTab() {
  const { send } = useDebugTransport()
  // ...
  return (
    <div className="flex h-full flex-col gap-3" data-testid="run-tab">
      {/* header */}
      <TriggerSelector />
      <RequestBuilder />
      <StatusBanner send={send} />
    </div>
  )
}
```

`SendButton` is inside `RequestBuilder` and uses its own `useDebugTransport()` call — the hook is safe to call from multiple components (singleton WS).

- [ ] **Step 5: Typecheck + test**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10 && pnpm --filter @darrylondil/lorien-ide test debug-session -- --run 2>&1 | tail -15
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/ide/src/panels/run-tab/status-banner.tsx packages/ide/src/panels/run-tab/request-builder.tsx packages/ide/src/panels/run-tab/index.tsx packages/ide/src/store/debug-session.ts packages/ide/src/store/debug-session.test.ts
git commit -m "feat(ide): Send button + StatusBanner + step controls

Send validates JSON body, calls recordFire on the store, sends 'fire'
over the WS. Status banner shows the current run state; step controls
(continue/step/step-over/stop/replay) are exposed only in the
appropriate states. Replaces beginRun with recordFire + lazy run
creation on the first incoming event so the IDE's run record uses the
server's authoritative runId.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: `<Timeline>` + `<RunPicker>`

**Files:**
- Create: `packages/ide/src/panels/run-tab/timeline.tsx`
- Create: `packages/ide/src/panels/run-tab/run-picker.tsx`
- Modify: `packages/ide/src/panels/run-tab/index.tsx`

- [ ] **Step 1: Implement `<Timeline>`**

```tsx
// packages/ide/src/panels/run-tab/timeline.tsx
import { useState } from "react"
import { useDebugSessionStore, type RunRecord } from "@/store/debug-session"

export function Timeline() {
  const runs = useDebugSessionStore((s) => s.runs)
  const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)
  const run =
    runs.find((r) => r.runId === selectedRunId) ?? runs[0] ?? null

  if (!run) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        No runs yet. Click <strong>Send</strong> to fire a debug run.
      </div>
    )
  }

  // Group consecutive edge-fired events under the following before-node
  const rows = foldEdges(run)

  return (
    <div className="flex flex-col gap-1 font-mono text-[11px]">
      {rows.map((row, i) => (
        <TimelineRow key={i} row={row} />
      ))}
      {run.outcome.kind === "ok" && (
        <div className="text-green-700">
          +{run.outcome.totalMs}ms ● complete {run.outcome.status}
        </div>
      )}
      {run.outcome.kind === "err" && (
        <div className="text-red-700">✕ {run.outcome.message}</div>
      )}
    </div>
  )
}

interface FoldedRow {
  offsetMs: number
  kind: "before" | "after" | "error"
  nodeId: string
  payload: unknown
  precedingEdges: Array<{ from: string; to: string; value: unknown }>
}

function foldEdges(run: RunRecord): FoldedRow[] {
  const rows: FoldedRow[] = []
  let pendingEdges: FoldedRow["precedingEdges"] = []
  for (const e of run.events) {
    if (e.event.type === "edge-fired") {
      pendingEdges.push({ from: e.event.from, to: e.event.to, value: e.event.value })
      continue
    }
    if (e.event.type === "before-node") {
      rows.push({
        offsetMs: e.offsetMs,
        kind: "before",
        nodeId: e.event.nodeId,
        payload: e.event.input,
        precedingEdges: pendingEdges,
      })
      pendingEdges = []
      continue
    }
    if (e.event.type === "after-node") {
      rows.push({
        offsetMs: e.offsetMs,
        kind: "after",
        nodeId: e.event.nodeId,
        payload: e.event.output,
        precedingEdges: [],
      })
      continue
    }
    if (e.event.type === "error") {
      rows.push({
        offsetMs: e.offsetMs,
        kind: "error",
        nodeId: e.event.nodeId,
        payload: e.event.error,
        precedingEdges: [],
      })
      continue
    }
    // complete handled outside (it's on the outcome)
  }
  return rows
}

function TimelineRow({ row }: { row: FoldedRow }) {
  const [open, setOpen] = useState(false)
  const arrow = open ? "▾" : "▸"
  const tone =
    row.kind === "error"
      ? "text-red-700"
      : row.kind === "before"
        ? "text-foreground"
        : "text-muted-foreground"
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left hover:bg-accent/30"
      >
        <span className="w-12 text-muted-foreground">+{row.offsetMs}ms</span>
        <span>{arrow}</span>
        <span className={tone}>{row.kind}</span>
        <span className="text-foreground">{row.nodeId}</span>
        {row.precedingEdges.length > 0 && (
          <span className="ml-1 text-muted-foreground">
            ← {row.precedingEdges.length} input{row.precedingEdges.length > 1 ? "s" : ""}
          </span>
        )}
      </button>
      {open && (
        <pre className="ml-12 max-h-48 overflow-auto rounded-md bg-muted/40 p-2 text-[10px]">
          {row.precedingEdges.length > 0 && (
            <>
              <strong>inputs from edges:</strong>
              {"\n"}
              {JSON.stringify(row.precedingEdges, null, 2)}
              {"\n\n"}
            </>
          )}
          <strong>{row.kind === "before" ? "input" : row.kind === "after" ? "output" : "error"}:</strong>
          {"\n"}
          {row.kind === "error"
            ? String(row.payload)
            : JSON.stringify(row.payload, null, 2)}
        </pre>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Implement `<RunPicker>`**

```tsx
// packages/ide/src/panels/run-tab/run-picker.tsx
import { useDebugSessionStore } from "@/store/debug-session"

export function RunPicker() {
  const runs = useDebugSessionStore((s) => s.runs)
  const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)
  const selectRun = useDebugSessionStore((s) => s.selectRun)
  if (runs.length === 0) return null
  const selected = runs.find((r) => r.runId === selectedRunId) ?? runs[0]!
  return (
    <select
      className="rounded-md border bg-background px-2 py-1 text-[10px]"
      value={selected.runId}
      onChange={(e) => selectRun(e.target.value)}
    >
      {runs.map((r) => (
        <option key={r.runId} value={r.runId}>
          {new Date(r.startedAt).toLocaleTimeString()} · {r.request.method}{" "}
          {r.request.path} ·{" "}
          {r.outcome.kind === "running"
            ? "…"
            : r.outcome.kind === "ok"
              ? `${r.outcome.status} (${r.outcome.totalMs}ms)`
              : `err`}
        </option>
      ))}
    </select>
  )
}
```

- [ ] **Step 3: Wire into `<RunTab>`**

```tsx
import { Timeline } from "./timeline"
import { RunPicker } from "./run-picker"

// In the JSX, after StatusBanner:
<div className="flex items-center justify-between">
  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Timeline</div>
  <RunPicker />
</div>
<Timeline />
```

- [ ] **Step 4: Typecheck**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/ide/src/panels/run-tab/timeline.tsx packages/ide/src/panels/run-tab/run-picker.tsx packages/ide/src/panels/run-tab/index.tsx
git commit -m "feat(ide): RunTab — Timeline + RunPicker

Timeline folds consecutive edge-fired events into the following
before-node row with an '← N inputs' badge. Each row expands to show
JSON-pretty-printed payload. RunPicker is a thin dropdown over the
last 10 runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Canvas — node status borders + RFNode data wiring

**Files:**
- Modify: `packages/ide/src/globals.css` — keyframes for pulse-blue animation
- Modify: `packages/ide/src/workflow/workflow-node.tsx` — apply status border classes
- Modify: `packages/ide/src/workflow/workflow-editor.tsx` — feed `nodeStatuses` from `debug-session` into RFNode data
- Modify: `packages/ide/src/workflow/workflow-node.test.tsx` — coverage

- [ ] **Step 1: Add the pulse animation CSS**

In `packages/ide/src/globals.css`, append:

```css
@keyframes lorien-pulse-blue {
  0%, 100% {
    box-shadow: 0 0 0 0 rgb(59 130 246 / 0.4);
  }
  50% {
    box-shadow: 0 0 0 4px rgb(59 130 246 / 0);
  }
}

.lorien-running {
  animation: lorien-pulse-blue 1.2s ease-in-out infinite;
  border-color: rgb(59 130 246);
}
.lorien-completed {
  border-color: rgb(34 197 94);
}
.lorien-errored {
  border-color: rgb(239 68 68);
}
.lorien-paused {
  border-color: rgb(234 179 8);
  border-width: 2px;
}
```

- [ ] **Step 2: Write a failing test in `workflow-node.test.tsx`**

```tsx
describe("node status borders (debugger)", () => {
  const baseData = {
    id: "n1",
    instance: { uses: "@core/http-request", in: {} },
    ports: { inputs: { id: "", label: "input", children: [], isLeaf: true }, outputs: [] },
    expandedInputs: new Set<string>(),
    expandedOutputs: new Set<string>(),
    onTogglePort: () => {},
    onInputValueChange: () => {},
  }

  it("applies lorien-running class when data.nodeStatus === 'running'", () => {
    const { container } = render(
      <WorkflowNode data={{ ...baseData, nodeStatus: "running" }} />,
    )
    expect(container.querySelector(".lorien-running")).toBeTruthy()
  })

  it("applies lorien-paused class when data.nodeStatus === 'paused'", () => {
    const { container } = render(
      <WorkflowNode data={{ ...baseData, nodeStatus: "paused" }} />,
    )
    expect(container.querySelector(".lorien-paused")).toBeTruthy()
  })

  it("applies lorien-errored class when data.nodeStatus === 'errored'", () => {
    const { container } = render(
      <WorkflowNode data={{ ...baseData, nodeStatus: "errored" }} />,
    )
    expect(container.querySelector(".lorien-errored")).toBeTruthy()
  })

  it("no status class when data.nodeStatus is undefined", () => {
    const { container } = render(<WorkflowNode data={baseData} />)
    expect(container.querySelector(".lorien-running")).toBeFalsy()
    expect(container.querySelector(".lorien-paused")).toBeFalsy()
  })
})
```

- [ ] **Step 3: Verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test workflow-node.test -- --run 2>&1 | tail -15
```

Expected: FAIL.

- [ ] **Step 4: Apply the class in `workflow-node.tsx`**

Find the outer node container (around the `data-testid` for the node body). Add the conditional class:

```tsx
const status = (data as { nodeStatus?: "running" | "completed" | "errored" | "paused" }).nodeStatus
const statusClass =
  status === "running" ? "lorien-running"
    : status === "completed" ? "lorien-completed"
    : status === "errored" ? "lorien-errored"
    : status === "paused" ? "lorien-paused"
    : ""

return (
  <div
    className={cn("relative rounded-md border bg-background", statusClass)}
    // ...existing props
  >
    {/* ...existing content... */}
  </div>
)
```

- [ ] **Step 5: Feed `nodeStatuses` from the store into RFNode data in `workflow-editor.tsx`**

In the node-init effect in `workflow-editor.tsx`, read `nodeStatuses` from the debug-session store and include it on each `RFNode.data`:

```ts
import { useDebugSessionStore } from "@/store/debug-session"

// Inside WorkflowEditor, near other store subscriptions:
const nodeStatuses = useDebugSessionStore((s) => s.nodeStatuses)

// In the node-init useEffect, when building the `initial` array:
return {
  id,
  type: "workflow",
  position: view ?? autoPosition(i),
  dragHandle: ".node-drag-handle",
  data: {
    // ...existing fields...
    nodeStatus: nodeStatuses.get(id),
  },
}
```

Add `nodeStatuses` to that effect's dep array so the data refreshes when statuses change.

CAUTION: per Task 2 in the prior plan (ide-editor-polish, item 2 fix), this effect uses `expansionRef.current` to avoid rebuilds on every expansion change. The same pattern should apply for `nodeStatuses` — wrap it in a ref and read `nodeStatusesRef.current.get(id)` so a status change triggers a single targeted update path (a separate effect that updates only `data.nodeStatus` on each existing RFNode):

```ts
const nodeStatusesRef = useRef(nodeStatuses)
nodeStatusesRef.current = nodeStatuses

useEffect(() => {
  setNodes((nds) =>
    nds.map((n) => ({
      ...n,
      data: { ...n.data, nodeStatus: nodeStatuses.get(n.id) },
    })),
  )
}, [nodeStatuses, setNodes])
```

This avoids tearing down + rebuilding the entire `initial` array on every status update.

- [ ] **Step 6: Verify PASS + typecheck**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test workflow-node.test -- --run 2>&1 | tail -15 && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/ide/src/globals.css packages/ide/src/workflow/workflow-node.tsx packages/ide/src/workflow/workflow-node.test.tsx packages/ide/src/workflow/workflow-editor.tsx
git commit -m "feat(ide): canvas node status borders driven by debug-session store

Nodes apply lorien-running (pulse blue) / completed (green) / errored
(red) / paused (yellow + thicker) classes based on data.nodeStatus.
workflow-editor.tsx subscribes to nodeStatuses and updates RFNode
data via a dedicated effect (no full rebuild).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Breakpoint dots + right-click context menu items

**Files:**
- Modify: `packages/ide/src/workflow/workflow-node.tsx` — render dots; pass workflow path + onToggleBreakpoint
- Modify: `packages/ide/src/workflow/workflow-editor.tsx` — context menu items wired to `toggleBreakpoint`
- Modify: `packages/ide/src/workflow/workflow-node.test.tsx` — dot coverage
- Modify: `packages/ide/src/workflow/workflow-editor.test.tsx` — context menu coverage

- [ ] **Step 1: Failing test — red dot for node-level breakpoint**

In `workflow-node.test.tsx`:

```tsx
describe("breakpoint dots", () => {
  it("renders a red dot on the header when data.hasNodeBreakpoint is true", () => {
    const data = { /* base from previous test */, hasNodeBreakpoint: true }
    const { container } = render(<WorkflowNode data={data as never} />)
    expect(container.querySelector('[data-testid="node-breakpoint-dot"]')).toBeTruthy()
  })

  it("renders a port breakpoint dot at the matching output port", () => {
    const data = {
      /* base */,
      ports: {
        inputs: { id: "", label: "input", children: [], isLeaf: true },
        outputs: [{ id: "foo", label: "foo", children: [], isLeaf: true }],
      },
      portBreakpoints: new Set(["foo"]),
    }
    const { container } = render(<WorkflowNode data={data as never} />)
    expect(container.querySelector('[data-testid="port-breakpoint-foo"]')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Verify FAIL → Implement dots in `workflow-node.tsx`**

Add `hasNodeBreakpoint?: boolean` and `portBreakpoints?: Set<string>` to the data shape. In the header div, conditionally render:

```tsx
{(data as { hasNodeBreakpoint?: boolean }).hasNodeBreakpoint && (
  <span
    data-testid="node-breakpoint-dot"
    className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-600"
    aria-label="breakpoint"
  />
)}
```

For each output port row in `PortRow` (when rendering output side), check `portBreakpoints?.has(port.id)` and render a small red dot overlaid on the handle:

```tsx
{!isInput && (data as { portBreakpoints?: Set<string> }).portBreakpoints?.has(port.id) && (
  <span
    data-testid={`port-breakpoint-${port.id}`}
    className="absolute h-2 w-2 rounded-full bg-red-600"
    style={{ right: -4, top: "50%", transform: "translateY(-50%)" }}
  />
)}
```

- [ ] **Step 3: Wire data from the debug store in `workflow-editor.tsx`**

Similar to nodeStatuses, derive per-node breakpoint summaries and feed them into RFNode data:

```ts
const breakpoints = useDebugSessionStore((s) => s.breakpoints)
const workflowPath = /* the active workflow's path — already available in the file */

useEffect(() => {
  setNodes((nds) =>
    nds.map((n) => {
      const bps = breakpoints.filter(
        (b) => b.workflowPath === workflowPath && b.nodeId === n.id,
      )
      const hasNodeBreakpoint = bps.some(
        (b) => b.kind === "before" || b.kind === "after",
      )
      const portBreakpoints = new Set(
        bps
          .filter((b) => b.kind.startsWith("port:"))
          .map((b) => b.kind.slice("port:".length)),
      )
      return {
        ...n,
        data: { ...n.data, hasNodeBreakpoint, portBreakpoints },
      }
    }),
  )
}, [breakpoints, workflowPath, setNodes])
```

- [ ] **Step 4: Failing test for context menu items in `workflow-editor.test.tsx`**

```tsx
it("right-click on node header shows 'Toggle breakpoint (before)' menu item", async () => {
  // ...build a tiny workflow with one node, render the editor...
  fireEvent.contextMenu(screen.getByTestId("node-header"))
  expect(await screen.findByText(/Toggle breakpoint \(before\)/i)).toBeInTheDocument()
})

it("clicking 'Toggle breakpoint (before)' toggles a 'before' breakpoint in the store", async () => {
  // ...same setup...
  fireEvent.contextMenu(screen.getByTestId("node-header"))
  fireEvent.click(await screen.findByText(/Toggle breakpoint \(before\)/i))
  const bps = useDebugSessionStore.getState().breakpoints
  expect(bps).toContainEqual({
    workflowPath: expect.any(String),
    nodeId: expect.any(String),
    kind: "before",
  })
})
```

- [ ] **Step 5: Add the menu items**

Find the existing right-click context menu in `workflow-editor.tsx` (introduced for "Delete node" / "Reset connections" / "View source"). Add a new item:

```tsx
<ContextMenuItem
  onClick={() => {
    toggleBreakpoint({
      workflowPath,
      nodeId: contextNodeId,
      kind: "before",
    })
  }}
>
  Toggle breakpoint (before)
</ContextMenuItem>
```

For port-level breakpoint: add a similar item to the per-port row context menu, OR document that v1 only supports right-clicking the node (and port-level bps land in a follow-up). **Decision for this plan:** v1 supports node-level (`before`) right-click. Port-level breakpoints are still possible via store action but no canvas right-click UI yet. Add `Toggle breakpoint (after)` to the same node header menu so users can break on the node's exit too.

If port-level UI is desired in v1, it requires adding a context menu to each port row in `PortRow` — straightforward extension. For scope, plan ships node-level only.

- [ ] **Step 6: Verify PASS + typecheck**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test workflow-editor.test workflow-node.test -- --run 2>&1 | tail -20 && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/ide/src/workflow/workflow-node.tsx packages/ide/src/workflow/workflow-editor.tsx packages/ide/src/workflow/workflow-node.test.tsx packages/ide/src/workflow/workflow-editor.test.tsx
git commit -m "feat(ide): breakpoint dots on canvas + node-level right-click toggle

Red dot on the node header when a 'before' or 'after' breakpoint is
set for the node. Red dot at the matching output port handle for
port:* breakpoints. Right-click on the node header adds 'Toggle
breakpoint (before)' and 'Toggle breakpoint (after)' menu items;
port-level UI deferred.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Edge-fired flash animation

**Files:**
- Modify: `packages/ide/src/workflow/workflow-editor.tsx` — subscribe to incoming `edge-fired` events; animate the matching RF edge briefly

- [ ] **Step 1: Subscribe to the latest event of the selected run**

In `workflow-editor.tsx`, add an effect that listens for new `edge-fired` events and momentarily bumps the `strokeOpacity` of the matching edge:

```ts
import { useDebugSessionStore } from "@/store/debug-session"

const runs = useDebugSessionStore((s) => s.runs)
const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)
const currentRun = runs.find((r) => r.runId === selectedRunId) ?? runs[0]
const lastEventIdxRef = useRef<number>(-1)

useEffect(() => {
  if (!currentRun) return
  const evts = currentRun.events
  for (let i = lastEventIdxRef.current + 1; i < evts.length; i++) {
    const e = evts[i]!.event
    if (e.type !== "edge-fired") continue
    // Parse "fromNode.field" → match against edge.source/sourceHandle
    const dot = e.from.indexOf(".")
    const fromNode = dot >= 0 ? e.from.slice(0, dot) : e.from
    const fromHandle = dot >= 0 ? e.from.slice(dot + 1) : ""
    setEdges((eds) =>
      eds.map((ed) => {
        if (
          ed.source === fromNode &&
          (!fromHandle || ed.sourceHandle === fromHandle)
        ) {
          return { ...ed, animated: true, style: { ...ed.style, strokeOpacity: 1 } }
        }
        return ed
      }),
    )
    const id = setTimeout(() => {
      setEdges((eds) =>
        eds.map((ed) => ({
          ...ed,
          animated: false,
          style: { ...ed.style, strokeOpacity: undefined },
        })),
      )
    }, 300)
    void id
  }
  lastEventIdxRef.current = evts.length - 1
}, [currentRun?.events.length])
```

- [ ] **Step 2: Typecheck**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: clean. (Pure visual; no specific unit test required.)

- [ ] **Step 3: Commit**

```bash
git add packages/ide/src/workflow/workflow-editor.tsx
git commit -m "feat(ide): edge-fired flash animation on the workflow canvas

Subscribes to the currently-selected run's events and momentarily
bumps strokeOpacity + animation on each React Flow edge whose source
matches an edge-fired event's 'from'. Fades back after 300ms.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: End-to-end integration test

**Files:**
- Create: `packages/runtime/src/dev-server/debug-e2e.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/src/dev-server/debug-e2e.test.ts
import { createServer, type Server as HttpServer } from "node:http"
import { describe, expect, it } from "vitest"
import { Hono } from "hono"
import { WebSocket } from "ws"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { DebugSession } from "./debug-session.js"
import { attachDebugWebSocket } from "./debug-ws.js"
import type { ServerMessage } from "./debug-protocol.js"
import type { LoadedWorkflow } from "./load.js"

function startEphemeralWith(session: DebugSession) {
  const app = new Hono()
  return new Promise<{ server: HttpServer; port: number }>((resolve) => {
    const server = createServer(async (req, res) => {
      const url = `http://${req.headers.host}${req.url ?? "/"}`
      const r = await app.fetch(new Request(url, { method: req.method ?? "GET" }))
      res.writeHead(r.status)
      res.end(await r.text())
    })
    attachDebugWebSocket({ app, server, session })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({ server, port })
    })
  })
}

describe("debugger end-to-end", () => {
  it("set-breakpoints + fire + pause + continue + run-complete", async () => {
    const echo = defineNode({
      name: "echo",
      inputs: z.object({ msg: z.string() }),
      outputs: z.object({ msg: z.string() }),
      async run({ msg }) {
        return { msg }
      },
    })
    const wf = {
      relativePath: "workflows/echo.workflow",
      file: {
        lorien: 1 as const,
        nodes: {
          request: {
            uses: "@core/http-request" as const,
            values: { method: "POST", path: "/echo" },
          },
          echo: { uses: "./nodes/echo" as const, in: { msg: "request.body.msg" } },
          response: { uses: "@core/response" as const, in: { body: "echo.msg" } },
        },
      },
    } as unknown as LoadedWorkflow

    const session = new DebugSession({
      getWorkflow: (p) => (p === wf.relativePath ? wf : null),
      getServices: async () => ({}) as never,
      resolveNode: (uses) => (uses === "./nodes/echo" ? echo : null),
    })
    const { server, port } = await startEphemeralWith(session)

    const ws = new WebSocket(`ws://127.0.0.1:${port}/__lorien/debug/ws`, {
      headers: { origin: "http://localhost:5173" },
    })
    const received: ServerMessage[] = []
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve())
      ws.on("error", reject)
    })
    ws.on("message", (raw) => {
      received.push(JSON.parse(raw.toString()) as ServerMessage)
    })

    ws.send(
      JSON.stringify({
        type: "hello",
        breakpoints: [
          {
            workflowPath: "workflows/echo.workflow",
            nodeId: "echo",
            kind: "before",
          },
        ],
      }),
    )
    // Wait for ready
    await new Promise((r) => setTimeout(r, 30))

    ws.send(
      JSON.stringify({
        type: "fire",
        workflowPath: "workflows/echo.workflow",
        triggerNodeId: "request",
        request: { method: "POST", path: "/echo", body: { msg: "hi" } },
      }),
    )
    // Wait until paused
    await new Promise((r) => setTimeout(r, 80))
    const paused = received.find((m) => m.type === "paused")
    expect(paused).toBeTruthy()
    expect((paused as Extract<ServerMessage, { type: "paused" }>).nodeId).toBe("echo")

    ws.send(JSON.stringify({ type: "continue" }))
    await new Promise((r) => setTimeout(r, 80))
    const complete = received.find((m) => m.type === "run-complete")
    expect(complete).toBeTruthy()
    expect((complete as Extract<ServerMessage, { type: "run-complete" }>).body).toBe("hi")

    ws.close()
    server.close()
  })
})
```

- [ ] **Step 2: Verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test debug-e2e -- --run 2>&1 | tail -20
```

Expected: green.

- [ ] **Step 3: Run the full test suite across all packages + typecheck + build**

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test 2>&1 | tail -30 && pnpm -r typecheck 2>&1 | tail -20 && pnpm -r build 2>&1 | tail -20
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/src/dev-server/debug-e2e.test.ts
git commit -m "test(runtime): end-to-end debugger flow

Boots a real Hono+ws server, opens a real WebSocket client, runs the
full set-breakpoints + fire + pause + continue + run-complete
sequence against a 3-node workflow. Validates that the protocol +
DebugSession + runWorkflow integration works end-to-end.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

After all 19 tasks land, run the full project gate:

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test 2>&1 | tail -30
cd C:/Users/hello/source/cozy-api && pnpm -r typecheck 2>&1 | tail -20
cd C:/Users/hello/source/cozy-api && pnpm -r build 2>&1 | tail -20
```

All three must be clean before declaring the subsystem done. Manual sanity check: start the IDE (`pnpm dev` or the equivalent in this repo), open a workflow with an `@core/http-request` trigger, switch to the Run tab, set a breakpoint on a node by right-clicking, click Send. The run should pause at the breakpoint; Continue should resume it; the timeline should populate.

Out-of-scope items from the spec (port-level right-click UI, pause-on-error toggle, conditional breakpoints, service mocks, auto-attach to externally-triggered requests, trace export) are deliberately not implemented in this plan.
