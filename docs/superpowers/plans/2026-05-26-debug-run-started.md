# Debug Panel `run-started` Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `GET /` placeholder in the Debug dock panel by broadcasting a new `run-started` server message that carries the request envelope (method, path, query, headers, body) for every run, IDE-Send and external (curl/Postman) alike.

**Architecture:** A single new wire message — `run-started` — is broadcast synchronously inside `mountWorkflows`'s handler before `runWorkflow` is awaited, so it always arrives at the IDE before any lifecycle `event` for the same `runId`. `RequestEnvelope` returns to the wire (only in this message). The IDE store creates the `RunRecord` from `run-started`; the existing lazy-create-on-`event` becomes a defensive `console.warn` fallback.

**Tech Stack:** TypeScript ESM (NodeNext), pnpm workspaces, Vitest, Hono, Zustand (IDE state), `ws` (WebSocket), `tsup` (build).

**Spec:** `docs/superpowers/specs/2026-05-26-debug-run-started-design.md`

---

## File Structure

**Modified:**
- `packages/runtime/src/dev-server/debug-protocol.ts` — add `run-started` to `ServerMessage`; update `RequestEnvelope` comment.
- `packages/runtime/src/dev-server/server.ts` — extend `DebugIntegration.buildRun` signature; build envelope; pass to `buildRun`.
- `packages/runtime/src/dev-server/server.test.ts` — update existing buildRun assertions; add envelope assertion.
- `packages/runtime/src/dev-server/debug-e2e.test.ts` — update inline buildRun stub; add wire-ordering test.
- `packages/build/src/commands/ide.ts` — replace inline `debug` literal with the new factory.
- `packages/ide/src/store/debug-session.ts` — add `run-started` case; downgrade lazy-create.
- `packages/ide/src/store/debug-session.test.ts` — three new tests.

**Created:**
- `packages/build/src/commands/debug-integration.ts` — factory `makeDebugIntegration(debugSession): DebugIntegration`. Holds the closure that was inline in `ide.ts`; allows direct unit testing of the broadcast.
- `packages/build/src/commands/debug-integration.test.ts` — unit test that `buildRun` broadcasts `run-started` with the envelope, before `registerRun`.

**Not touched:** `packages/ide/src/hooks/use-debug-transport.ts` — already passes any `ServerMessage` to the store; no change needed once the union grows.

---

## Task 1: Add `run-started` to the protocol union

**Files:**
- Modify: `packages/runtime/src/dev-server/debug-protocol.ts`

- [ ] **Step 1: Update `RequestEnvelope` JSDoc and append `run-started` to `ServerMessage`**

Open `packages/runtime/src/dev-server/debug-protocol.ts`. Change the comment on `RequestEnvelope` from:

```ts
/** Used by the IDE to record what was fired; no longer appears on the wire. */
```

to:

```ts
/**
 * Captured per HTTP request that triggers a workflow. Appears on the wire in
 * the `run-started` server message; also used IDE-side for the request-history
 * table (independent of the wire message — they cover different surfaces).
 */
```

Add a new variant at the end of the `ServerMessage` union (before the `| { type: "ack"; for: ClientMessage["type"] }` line — `ack` should stay last):

```ts
  | {
      type: "run-started"
      runId: string
      workflowPath: string
      triggerNodeId: string
      request: RequestEnvelope
    }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @darrylondil/lorien-runtime typecheck`
Expected: PASS (no callers reference `run-started` yet).

- [ ] **Step 3: Commit**

```bash
git add packages/runtime/src/dev-server/debug-protocol.ts
git commit -m "feat(runtime): add run-started ServerMessage type"
```

---

## Task 2: Extend `DebugIntegration.buildRun` signature with envelope (TDD)

**Files:**
- Modify: `packages/runtime/src/dev-server/server.ts`
- Modify: `packages/runtime/src/dev-server/server.test.ts`
- Modify: `packages/runtime/src/dev-server/debug-e2e.test.ts:71-95` (inline buildRun stub)
- Modify: `packages/build/src/commands/ide.ts:370-406` (inline buildRun closure — accept new params, keep behavior)

- [ ] **Step 1: Write the failing test**

In `packages/runtime/src/dev-server/server.test.ts`, inside the `describe("mountWorkflows with debug integration", ...)` block, append a new test (right after the existing `calls debug.newRunId, buildRun, onResult on success` test):

```ts
it("buildRun receives triggerNodeId and the full request envelope", async () => {
  const wf = makeEchoWorkflow()

  const newRunId = vi.fn(() => "test-run-77")
  const lifecycle = new LifecycleEmitter()
  const buildRun = vi.fn(() => ({ lifecycle }))
  const onResult = vi.fn()
  const onError = vi.fn()

  const debug: DebugIntegration = { newRunId, buildRun, onResult, onError }
  const app = new Hono()
  mountWorkflows(app, [wf], { nodes: {}, services: {}, debug })

  const res = await app.request("/echo?lang=en", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test": "hi" },
    body: JSON.stringify({ msg: "hello" }),
  })
  expect(res.status).toBe(200)

  expect(buildRun).toHaveBeenCalledOnce()
  const [runId, workflowPath, triggerNodeId, request] = buildRun.mock.calls[0]
  expect(runId).toBe("test-run-77")
  expect(workflowPath).toBe("echo.workflow")
  expect(triggerNodeId).toBe("req")
  expect(request).toMatchObject({
    method: "POST",
    path: "/echo",
    query: { lang: "en" },
    headers: expect.objectContaining({ "x-test": "hi" }),
    body: { msg: "hello" },
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @darrylondil/lorien-runtime test -- server.test`
Expected: FAIL — `buildRun` is called with only `(runId, workflowPath)`; the test's destructuring of `triggerNodeId`/`request` will be `undefined`.

- [ ] **Step 3: Update the `DebugIntegration.buildRun` signature in `server.ts`**

In `packages/runtime/src/dev-server/server.ts`, at the top, add an import for `RequestEnvelope`:

```ts
import type { RequestEnvelope } from "./debug-protocol.js"
```

Replace the `buildRun` declaration in the `DebugIntegration` interface (currently around lines 14-21):

```ts
  buildRun: (
    runId: string,
    workflowPath: string,
    triggerNodeId: string,
    request: RequestEnvelope,
  ) => {
    lifecycle: LifecycleEmitter
    onBeforeNode?: (nodeId: string, input: Record<string, unknown>) => Promise<void>
    onAfterNode?: (nodeId: string, output: Record<string, unknown>) => Promise<void>
  }
```

- [ ] **Step 4: Build the envelope in the handler and pass it to `buildRun`**

In the same file, locate the handler block (around line 60-86). Replace the section that currently extracts body/query/headers and calls `buildRun`:

```ts
        let body: unknown = null
        const contentType = c.req.header("content-type") ?? ""
        if (contentType.includes("application/json")) {
          try {
            body = await c.req.json()
          } catch {
            body = null
          }
        } else if (c.req.raw.body) {
          body = await c.req.text()
        }

        const url = new URL(c.req.url)
        const query: Record<string, string> = {}
        url.searchParams.forEach((v, k) => {
          query[k] = v
        })
        const headers: Record<string, string> = {}
        c.req.raw.headers.forEach((v, k) => {
          headers[k] = v
        })

        const run = opts.debug?.buildRun(runId, wf.relativePath)
```

with:

```ts
        let body: unknown = null
        const contentType = c.req.header("content-type") ?? ""
        if (contentType.includes("application/json")) {
          try {
            body = await c.req.json()
          } catch {
            body = null
          }
        } else if (c.req.raw.body) {
          body = await c.req.text()
        }

        const url = new URL(c.req.url)
        const query: Record<string, string> = {}
        url.searchParams.forEach((v, k) => {
          query[k] = v
        })
        const headers: Record<string, string> = {}
        c.req.raw.headers.forEach((v, k) => {
          headers[k] = v
        })

        const request: RequestEnvelope = {
          method: c.req.method,
          path: url.pathname,
          ...(Object.keys(query).length > 0 ? { query } : {}),
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
          ...(body !== null ? { body } : {}),
        }

        const run = opts.debug?.buildRun(runId, wf.relativePath, nodeId, request)
```

- [ ] **Step 5: Fix call site #1 — `debug-e2e.test.ts`**

In `packages/runtime/src/dev-server/debug-e2e.test.ts` around line 71, change the inline `buildRun` stub from:

```ts
    buildRun: (runId, workflowPath) => {
```

to:

```ts
    buildRun: (runId, workflowPath, _triggerNodeId, _request) => {
```

(Both `_triggerNodeId` and `_request` are unused in this stub. The leading underscore satisfies the no-unused-vars rule.)

- [ ] **Step 6: Fix call site #2 — `ide.ts`**

In `packages/build/src/commands/ide.ts` around line 370, change the inline `buildRun` closure signature from:

```ts
    buildRun: (runId, workflowPath) => {
```

to:

```ts
    buildRun: (runId, workflowPath, _triggerNodeId, _request) => {
```

(The next task wires the broadcast — for now, the parameters are accepted but unused.)

- [ ] **Step 7: Update the existing `toHaveBeenCalledWith` assertion in `server.test.ts`**

In the existing test `"calls debug.newRunId, buildRun, onResult on success"` (around line 135), replace:

```ts
    expect(buildRun).toHaveBeenCalledWith("test-run-42", "echo.workflow")
```

with:

```ts
    expect(buildRun).toHaveBeenCalledWith(
      "test-run-42",
      "echo.workflow",
      "req",
      expect.objectContaining({ method: "POST", path: "/echo", body: { msg: "hello" } }),
    )
```

(The exact-match form would break under any future envelope extension; `objectContaining` keeps this test focused on the trio that mattered originally — runId, workflowPath, triggerNodeId — and just spot-checks that the envelope is present.)

- [ ] **Step 8: Run tests**

Run: `pnpm --filter @darrylondil/lorien-runtime test`
Expected: ALL pass — including the new envelope-shape test.

Run: `pnpm --filter @darrylondil/lorien-build typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/runtime/src/dev-server/server.ts \
        packages/runtime/src/dev-server/server.test.ts \
        packages/runtime/src/dev-server/debug-e2e.test.ts \
        packages/build/src/commands/ide.ts
git commit -m "feat(runtime): DebugIntegration.buildRun gets triggerNodeId + request envelope"
```

---

## Task 3: Factor out `makeDebugIntegration` from `ide.ts`

This is a pure refactor (no behavior change) so the broadcast in Task 4 can be unit-tested without spinning up `runIde`.

**Files:**
- Create: `packages/build/src/commands/debug-integration.ts`
- Modify: `packages/build/src/commands/ide.ts`

- [ ] **Step 1: Create the factory file**

Create `packages/build/src/commands/debug-integration.ts` with:

```ts
import {
  type DebugIntegration,
  type DebugSession,
  LifecycleEmitter,
} from "@darrylondil/lorien-runtime"

/**
 * Builds the `DebugIntegration` used by the IDE command. The factory exists so
 * the wire-side broadcast (run-started, events, run-complete, run-error) can be
 * unit-tested without standing up the full IDE HTTP server.
 *
 * The returned integration is closed over `debugSession`; all broadcasts and
 * registrations route through it.
 */
export function makeDebugIntegration(debugSession: DebugSession): DebugIntegration {
  return {
    newRunId: () => `r-${Math.random().toString(36).slice(2, 10)}`,
    buildRun: (runId, workflowPath, _triggerNodeId, _request) => {
      const startedAt = Date.now()
      const lifecycle = new LifecycleEmitter()
      for (const t of [
        "before-node",
        "after-node",
        "edge-fired",
        "error",
        "complete",
      ] as const) {
        lifecycle.on(t, (ev) => {
          const wireEvent =
            ev.type === "error"
              ? {
                  type: "error" as const,
                  nodeId: ev.nodeId,
                  error: {
                    message: ev.error.message,
                    ...(ev.error.stack !== undefined ? { stack: ev.error.stack } : {}),
                  },
                }
              : ev
          debugSession.broadcast({
            type: "event",
            runId,
            event: wireEvent as never,
            offsetMs: Date.now() - startedAt,
          })
        })
      }
      const { onBeforeNode, onAfterNode } = debugSession.registerRun(
        workflowPath,
        runId,
        startedAt,
      )
      return { lifecycle, onBeforeNode, onAfterNode }
    },
    onResult: (runId, result, totalMs) => {
      debugSession.broadcast({
        type: "run-complete",
        runId,
        status: result.status,
        body: result.body,
        totalMs,
      })
      debugSession.unregisterRun(runId)
    },
    onError: (runId, err, totalMs) => {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      const nodeId =
        err && typeof err === "object" && "nodeId" in err
          ? ((err as { nodeId: unknown }).nodeId as string | undefined)
          : undefined
      debugSession.broadcast({
        type: "run-error",
        runId,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message,
        ...(stack !== undefined ? { stack } : {}),
      })
      debugSession.unregisterRun(runId)
      void totalMs
    },
  }
}
```

- [ ] **Step 2: Replace the inline `debug` in `ide.ts`**

In `packages/build/src/commands/ide.ts`, add the import near the top (with the other relative imports):

```ts
import { makeDebugIntegration } from "./debug-integration.js"
```

Replace the entire inline `const debug: DebugIntegration = { newRunId: ..., buildRun: ..., onResult: ..., onError: ... }` block (currently around lines 368-432) with a single line:

```ts
  const debug: DebugIntegration = makeDebugIntegration(debugSession)
```

Verify the surrounding context is preserved: `installConsoleCapture(...)` above stays, and `mountWorkflows(app, loadedWorkflows, { nodes: loadedNodes, services: loadedServices, debug })` below stays.

- [ ] **Step 3: Run all tests**

Run: `pnpm --filter @darrylondil/lorien-runtime test && pnpm --filter @darrylondil/lorien-build test`
Expected: ALL pass.

- [ ] **Step 4: Commit**

```bash
git add packages/build/src/commands/debug-integration.ts packages/build/src/commands/ide.ts
git commit -m "refactor(build): extract makeDebugIntegration from ide.ts"
```

---

## Task 4: Broadcast `run-started` from the factory (TDD)

**Files:**
- Create: `packages/build/src/commands/debug-integration.test.ts`
- Modify: `packages/build/src/commands/debug-integration.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/build/src/commands/debug-integration.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import {
  type RequestEnvelope,
  type ServerMessage,
  DebugSession,
} from "@darrylondil/lorien-runtime"
import { makeDebugIntegration } from "./debug-integration.js"

describe("makeDebugIntegration.buildRun", () => {
  it("broadcasts run-started with the envelope before registerRun runs", () => {
    const session = new DebugSession()
    const broadcasts: ServerMessage[] = []
    const sequence: string[] = []
    vi.spyOn(session, "broadcast").mockImplementation((msg) => {
      broadcasts.push(msg)
      sequence.push(`broadcast:${msg.type}`)
    })
    vi.spyOn(session, "registerRun").mockImplementation(() => {
      sequence.push("registerRun")
      return { onBeforeNode: async () => {}, onAfterNode: async () => {} }
    })

    const debug = makeDebugIntegration(session)
    const request: RequestEnvelope = {
      method: "POST",
      path: "/users",
      query: { source: "web" },
      headers: { "content-type": "application/json" },
      body: { email: "a@b.com" },
    }

    debug.buildRun("run-99", "workflows/users/create.workflow", "Request", request)

    expect(broadcasts).toContainEqual({
      type: "run-started",
      runId: "run-99",
      workflowPath: "workflows/users/create.workflow",
      triggerNodeId: "Request",
      request,
    })
    // run-started must be the FIRST thing that happens in buildRun
    expect(sequence[0]).toBe("broadcast:run-started")
    expect(sequence).toContain("registerRun")
    expect(sequence.indexOf("broadcast:run-started")).toBeLessThan(
      sequence.indexOf("registerRun"),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @darrylondil/lorien-build test -- debug-integration.test`
Expected: FAIL — no `run-started` message in `broadcasts`.

- [ ] **Step 3: Add the broadcast in the factory**

In `packages/build/src/commands/debug-integration.ts`, change the `buildRun` signature to use the params:

```ts
    buildRun: (runId, workflowPath, triggerNodeId, request) => {
```

(Remove the leading underscores added in Task 3.)

Insert the broadcast at the very top of the `buildRun` body, before `const startedAt = Date.now()`:

```ts
    buildRun: (runId, workflowPath, triggerNodeId, request) => {
      debugSession.broadcast({
        type: "run-started",
        runId,
        workflowPath,
        triggerNodeId,
        request,
      })
      const startedAt = Date.now()
      // ... rest unchanged ...
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @darrylondil/lorien-build test -- debug-integration.test`
Expected: PASS.

- [ ] **Step 5: Run all build-package tests**

Run: `pnpm --filter @darrylondil/lorien-build test`
Expected: ALL pass.

- [ ] **Step 6: Commit**

```bash
git add packages/build/src/commands/debug-integration.ts packages/build/src/commands/debug-integration.test.ts
git commit -m "feat(build): broadcast run-started before registerRun in IDE debug integration"
```

---

## Task 5: Store — handle `run-started` (happy path, TDD)

**Files:**
- Modify: `packages/ide/src/store/debug-session.test.ts`
- Modify: `packages/ide/src/store/debug-session.ts`

- [ ] **Step 1: Write the failing test**

In `packages/ide/src/store/debug-session.test.ts`, add a new test (place it inside whatever top-level `describe` covers `applyMessage`; if uncertain, add a new describe block):

```ts
import { describe, expect, it, beforeEach } from "vitest"
import { useDebugSessionStore } from "./debug-session"
import type { RequestEnvelope } from "@darrylondil/lorien-runtime"

describe("debug-session store — run-started", () => {
  beforeEach(() => {
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState())
  })

  it("creates a RunRecord with the real envelope and sets selectedRunId if null", () => {
    const request: RequestEnvelope = {
      method: "POST",
      path: "/users",
      query: { lang: "en" },
      headers: { "x-test": "1" },
      body: { email: "a@b.com" },
    }

    useDebugSessionStore.getState().applyMessage({
      type: "run-started",
      runId: "r-1",
      workflowPath: "workflows/users/create.workflow",
      triggerNodeId: "Request",
      request,
    })

    const s = useDebugSessionStore.getState()
    expect(s.runs).toHaveLength(1)
    const r = s.runs[0]!
    expect(r.runId).toBe("r-1")
    expect(r.workflowPath).toBe("workflows/users/create.workflow")
    expect(r.triggerNodeId).toBe("Request")
    expect(r.request).toEqual(request)
    expect(r.outcome).toEqual({ kind: "running" })
    expect(r.events).toEqual([])
    expect(r.logs).toEqual([])
    expect(s.selectedRunId).toBe("r-1")
  })

  it("is idempotent — duplicate run-started for same runId does not duplicate the record", () => {
    const request: RequestEnvelope = { method: "GET", path: "/health" }
    const msg = {
      type: "run-started" as const,
      runId: "r-dup",
      workflowPath: "wf",
      triggerNodeId: "T",
      request,
    }
    useDebugSessionStore.getState().applyMessage(msg)
    useDebugSessionStore.getState().applyMessage(msg)
    expect(useDebugSessionStore.getState().runs).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @darrylondil/lorien-ide test -- debug-session.test`
Expected: FAIL — switch has no `run-started` case; `runs` stays empty.

- [ ] **Step 3: Add the `run-started` case in the store**

In `packages/ide/src/store/debug-session.ts`, inside `applyMessage`'s switch (between `case "ready":` and `case "event":` is a natural spot), insert:

```ts
      case "run-started": {
        const { runId, workflowPath, triggerNodeId, request } = msg
        set((s) => {
          if (s.runs.find((r) => r.runId === runId)) return s
          const record: RunRecord = {
            runId,
            workflowPath,
            triggerNodeId,
            request,
            startedAt: Date.now(),
            events: [],
            logs: [],
            pausedFrame: null,
            outcome: { kind: "running" },
          }
          const runs = [record, ...s.runs].slice(0, 20)
          return { runs, selectedRunId: s.selectedRunId ?? runId }
        })
        return
      }
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @darrylondil/lorien-ide test -- debug-session.test`
Expected: PASS for both new tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ide/src/store/debug-session.ts packages/ide/src/store/debug-session.test.ts
git commit -m "feat(ide): handle run-started message in debug-session store"
```

---

## Task 6: Store — events after `run-started` append to the same record (TDD)

**Files:**
- Modify: `packages/ide/src/store/debug-session.test.ts`

This task verifies the existing `event` lazy-create branch is correctly skipped when `run-started` arrived first. No code change should be needed — the existing `runs.find` check in the `event` handler already short-circuits — but we lock the behavior in with a test.

- [ ] **Step 1: Add the test**

Append to the `describe("debug-session store — run-started", ...)` block in `packages/ide/src/store/debug-session.test.ts`:

```ts
  it("events after run-started append to the existing record (no second placeholder)", () => {
    useDebugSessionStore.getState().applyMessage({
      type: "run-started",
      runId: "r-2",
      workflowPath: "wf",
      triggerNodeId: "T",
      request: { method: "POST", path: "/x" },
    })
    useDebugSessionStore.getState().applyMessage({
      type: "event",
      runId: "r-2",
      offsetMs: 5,
      event: { type: "before-node", nodeId: "n1", input: {} },
    })

    const s = useDebugSessionStore.getState()
    expect(s.runs).toHaveLength(1)
    expect(s.runs[0]!.events).toHaveLength(1)
    // path stays from run-started, not overwritten by the lazy-create placeholder
    expect(s.runs[0]!.request.path).toBe("/x")
  })
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @darrylondil/lorien-ide test -- debug-session.test`
Expected: PASS (no code change needed).

- [ ] **Step 3: Commit**

```bash
git add packages/ide/src/store/debug-session.test.ts
git commit -m "test(ide): lock in run-started + event ordering in store"
```

---

## Task 7: Store — defensive lazy-create on unknown runId logs a warning (TDD)

**Files:**
- Modify: `packages/ide/src/store/debug-session.test.ts`
- Modify: `packages/ide/src/store/debug-session.ts`

- [ ] **Step 1: Write the failing test**

Append to the `describe("debug-session store — run-started", ...)` block:

```ts
  it("event arriving before run-started for a runId emits a console.warn and creates a placeholder record", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    useDebugSessionStore.getState().applyMessage({
      type: "event",
      runId: "r-orphan",
      offsetMs: 0,
      event: { type: "before-node", nodeId: "n1", input: {} },
    })

    const s = useDebugSessionStore.getState()
    expect(s.runs).toHaveLength(1)
    expect(s.runs[0]!.runId).toBe("r-orphan")
    expect(s.runs[0]!.request).toEqual({ method: "?", path: "?" })
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toMatch(/event arrived before run-started/i)

    warn.mockRestore()
  })
```

(Make sure `vi` is imported at the top of the test file: `import { describe, expect, it, beforeEach, vi } from "vitest"`. Adjust the import line if necessary.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @darrylondil/lorien-ide test -- debug-session.test`
Expected: FAIL — current lazy-create uses `{ method: "GET", path: "/" }` and does not warn.

- [ ] **Step 3: Update the lazy-create branch in the store**

In `packages/ide/src/store/debug-session.ts`, find the `case "event":` block (around line 135). Replace the lazy-create branch (currently around lines 139-153) — that is, the part that runs when `!runs.find((r) => r.runId === runId)`:

```ts
          if (!runs.find((r) => r.runId === runId)) {
            // Lazy-create record for runs we don't know about (e.g. external HTTP traffic)
            const record: RunRecord = {
              runId,
              workflowPath: "",
              triggerNodeId: "",
              request: { method: "GET", path: "/" },
              startedAt: Date.now(),
              events: [],
              logs: [],
              pausedFrame: null,
              outcome: { kind: "running" },
            }
            runs = [record, ...s.runs].slice(0, 20)
          }
```

with:

```ts
          if (!runs.find((r) => r.runId === runId)) {
            // Defensive: run-started should always arrive before any event. If we land
            // here, the server skipped it or the IDE bundle is stale. Warn loudly and
            // create a placeholder so the timeline isn't lost.
            console.warn(
              `[debug-session] event arrived before run-started for runId=${runId}`,
            )
            const record: RunRecord = {
              runId,
              workflowPath: "",
              triggerNodeId: "",
              request: { method: "?", path: "?" },
              startedAt: Date.now(),
              events: [],
              logs: [],
              pausedFrame: null,
              outcome: { kind: "running" },
            }
            runs = [record, ...s.runs].slice(0, 20)
          }
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @darrylondil/lorien-ide test -- debug-session.test`
Expected: PASS — all run-started tests pass, including the new defensive one. The events-after test from Task 6 still passes because `run-started` arrived first there.

- [ ] **Step 5: Commit**

```bash
git add packages/ide/src/store/debug-session.ts packages/ide/src/store/debug-session.test.ts
git commit -m "feat(ide): downgrade event-before-run-started to warn + ? placeholder"
```

---

## Task 8: E2E — `run-started` arrives before any `event` for the same runId (TDD)

**Files:**
- Modify: `packages/runtime/src/dev-server/debug-e2e.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/runtime/src/dev-server/debug-e2e.test.ts`, add a new test at the end of the `describe("debugger HTTP-driven e2e", ...)` block (after the existing two tests):

```ts
  it("broadcasts run-started before any event for the same runId, with the request envelope", async () => {
    const { server, port } = await startServerWithDebug()
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

    // No breakpoints — let the workflow run through.
    ws.send(JSON.stringify({ type: "hello", breakpoints: [] }))
    await new Promise((r) => setTimeout(r, 30))

    const httpRes = await fetch(`http://127.0.0.1:${port}/echo?lang=en`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173",
      },
      body: JSON.stringify({ msg: "wire-order" }),
    })
    expect(httpRes.status).toBe(200)

    await new Promise((r) => setTimeout(r, 50))

    const runStarted = received.find((m) => m.type === "run-started") as
      | Extract<ServerMessage, { type: "run-started" }>
      | undefined
    expect(runStarted).toBeTruthy()
    expect(runStarted!.workflowPath).toBe("workflows/echo.workflow")
    expect(runStarted!.triggerNodeId).toBe("request")
    expect(runStarted!.request).toMatchObject({
      method: "POST",
      path: "/echo",
      query: { lang: "en" },
      body: { msg: "wire-order" },
    })

    const runStartedIdx = received.findIndex((m) => m.type === "run-started")
    const firstEventIdx = received.findIndex(
      (m) =>
        m.type === "event" &&
        (m as Extract<ServerMessage, { type: "event" }>).runId === runStarted!.runId,
    )
    expect(firstEventIdx).toBeGreaterThan(-1)
    expect(runStartedIdx).toBeLessThan(firstEventIdx)

    ws.close()
    server.close()
  })
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @darrylondil/lorien-runtime test -- debug-e2e.test`
Expected: FAIL initially — the inline `buildRun` stub in `startServerWithDebug` does not broadcast `run-started`.

- [ ] **Step 3: Add the broadcast to the e2e helper's inline `buildRun`**

In `packages/runtime/src/dev-server/debug-e2e.test.ts`, find the inline `buildRun: (runId, workflowPath, _triggerNodeId, _request) => {` block. Change the parameter names and add the broadcast at the top of the body:

```ts
    buildRun: (runId, workflowPath, triggerNodeId, request) => {
      session.broadcast({
        type: "run-started",
        runId,
        workflowPath,
        triggerNodeId,
        request,
      })
      const startedAt = Date.now()
      const lifecycle = new LifecycleEmitter()
      // ... rest unchanged ...
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @darrylondil/lorien-runtime test -- debug-e2e.test`
Expected: PASS for the new test. The two existing e2e tests must also still pass.

- [ ] **Step 5: Run full runtime test suite**

Run: `pnpm --filter @darrylondil/lorien-runtime test`
Expected: ALL 177+ tests pass (was 176, +1 from Task 2, +1 from this task → ~178).

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/dev-server/debug-e2e.test.ts
git commit -m "test(runtime): e2e — run-started precedes event broadcasts"
```

---

## Task 9: Manual smoke — verify Debug panel shows real method+path

Rebuild and exercise the IDE against `examples/basic-api` to confirm the user-visible bug is fixed.

- [ ] **Step 1: Rebuild runtime + build packages**

Run:

```bash
pnpm --filter @darrylondil/lorien-runtime build
pnpm --filter @darrylondil/lorien-build build
```

Expected: both build successfully, no errors.

- [ ] **Step 2: Start the IDE against basic-api**

Run (from repo root):

```bash
node packages/build/dist/cli.js ide --no-open --root examples/basic-api --port 3737
```

Expected output line: `lorien IDE running at http://localhost:3737`.

- [ ] **Step 3: Open the IDE in a browser**

Visit `http://localhost:3737` and open the workflow `workflows/user/create.workflow`. Open the Debug dock panel (runs list should be empty with the "No runs yet" empty state).

- [ ] **Step 4: Fire a request from the Run tab**

Set method=POST, path=`/users`, body JSON `{"email":"a@b.com","password":"hunter22"}`. Click Send.

- [ ] **Step 5: Verify the Debug panel row**

In the Debug dock's runs list, the new row should show:
- method: `POST`
- path: `/users` (NOT `GET` and NOT `/`)
- a status badge (likely red if the dangling `save-user` node is still in the workflow — that's the separate user-data issue from earlier)

If the row still shows `GET /`, something earlier slipped. Check the browser console for the defensive `[debug-session] event arrived before run-started for runId=...` warning — if it fires, the server isn't broadcasting `run-started`. Re-check Task 4 / Task 8 changes.

- [ ] **Step 6: Fire an external request with curl**

In a separate terminal:

```bash
curl -X PUT http://localhost:3737/users -H "content-type: application/json" -d '{"x":1}'
```

(This will 404 because no PUT trigger exists, but it shouldn't create a Debug panel row at all — only requests that match a registered workflow trigger fire `run-started`.)

Then a real one:

```bash
curl -X POST http://localhost:3737/users -H "content-type: application/json" -d '{"email":"curl@ex.com","password":"hunter22"}'
```

Expected: a new row in the Debug panel showing `POST /users` (driven entirely by the server's `run-started`).

- [ ] **Step 7: Stop the IDE process**

Ctrl+C the IDE.

- [ ] **Step 8: Commit (no code change — manual checklist only)**

No commit. If any of the above failed, fix and re-test before claiming Task 9 complete.

---

## Final Verification

- [ ] All commits land on the branch in sequence.
- [ ] `pnpm test` (root) passes across all packages.
- [ ] `pnpm typecheck` (root) passes.
- [ ] Manual smoke from Task 9 shows real method+path in the Debug panel for both IDE Send and curl/Postman traffic.
- [ ] No `console.warn`s about `event arrived before run-started` during normal operation.
