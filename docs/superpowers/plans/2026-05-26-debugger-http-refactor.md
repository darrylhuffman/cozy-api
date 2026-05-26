# Debugger HTTP Refactor + Multi-Active Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reverse the firing path so the dev server's `mountWorkflows` handler is the single entry point for debug runs (external HTTP and IDE Send both hit the same code path). Make `DebugSession` multi-active. Switch the IDE Send button to a real `fetch`. Add a top-level Debug dock panel + Run-tab request history table + per-run logs.

**Architecture:** `MountOptions` gains an optional `debug` integration the IDE-server wires to a refactored multi-active `DebugSession`. The WS protocol's step commands carry `runId`; `fire`/`replay` are removed. The IDE replaces WS firing with `fetch` against `restBase()`, captures request history client-side, and moves all observe + control UI into a new Debug dock panel. Node `console.*` calls are tagged via `AsyncLocalStorage` and broadcast as a new `log` server message.

**Tech Stack:** TypeScript ESM (NodeNext), Node ≥16 (for `AsyncLocalStorage` + `node:async_hooks`), Hono + `hono/cors`, `ws`, Zod, Vitest, React 19, Zustand, React Flow, shadcn/ui (Select component added in this plan), `@monaco-editor/react`. pnpm workspaces.

**Working dir:** `C:\Users\hello\source\cozy-api`. Branch: continues on `feat/run-tab-body-picker` (or create a new branch if implementing this as a separate PR). Spec: `docs/superpowers/specs/2026-05-26-debugger-http-refactor-design.md`.

**Reading first:** spec §3 (server), §4 (protocol), §5 (IDE), §6 (errors). The existing debugger plan at `docs/superpowers/plans/2026-05-22-debugger-run-panel.md` is the prior baseline; many of its files are rewritten here.

---

## File map

**Create (runtime):**
- `packages/runtime/src/dev-server/cors.ts` — exports `isLoopbackOriginString` (extracted from agent-broker)
- `packages/runtime/src/dev-server/console-capture.ts` — `installConsoleCapture` + `withRunContext`
- `packages/runtime/src/dev-server/console-capture.test.ts`

**Modify (runtime):**
- `packages/runtime/src/agent-broker/server.ts` — import `isLoopbackOriginString` from the new shared module (drop the inline copy)
- `packages/runtime/src/dev-server/server.ts` — `MountOptions.debug`, handler rewrite (with `withRunContext`), drop `MountOptions.lifecycle`
- `packages/runtime/src/dev-server/server.test.ts` — new coverage for the debug integration path
- `packages/runtime/src/dev-server/debug-session.ts` — multi-active state machine (`registerRun`/`unregisterRun`/`getRunStartedAt`); drop `runFire`/`buildHooks` (renamed)/old `fire`+`replay` WS handlers
- `packages/runtime/src/dev-server/debug-session.test.ts` — multi-active rework
- `packages/runtime/src/dev-server/debug-protocol.ts` — commands carry `runId`; remove `fire`/`replay`; add `log` server message; extend `run-error` with optional `stack`; add `WireLifecycleEvent`
- `packages/runtime/src/dev-server/debug-e2e.test.ts` — replaced with HTTP-driven e2e
- `packages/runtime/src/index.ts` — re-export `DebugIntegration`, keep `RequestEnvelope` (still used by IDE)

**Modify (build):**
- `packages/build/src/commands/ide.ts` — install console capture; build `DebugIntegration` factory; add CORS for all routes; drop old `DebugSession` lifecycle wiring (no more sessions for runFire)

**Create (IDE):**
- `packages/ide/src/store/request-history.ts` — Zustand store for HTTP send history
- `packages/ide/src/store/request-history.test.ts`
- `packages/ide/src/components/ui/select.tsx` — shadcn Select (added via CLI)
- `packages/ide/src/panels/run-tab/history-table.tsx`
- `packages/ide/src/panels/run-tab/history-table.test.tsx`
- `packages/ide/src/panels/debug-panel/index.tsx` — `<DebugPanel>` root
- `packages/ide/src/panels/debug-panel/runs-list.tsx`
- `packages/ide/src/panels/debug-panel/runs-list.test.tsx`
- `packages/ide/src/panels/debug-panel/selected-run-view.tsx`
- `packages/ide/src/panels/debug-panel/selected-run-view.test.tsx`
- `packages/ide/src/panels/debug-panel/logs-view.tsx`
- `packages/ide/src/panels/debug-panel/logs-view.test.tsx`

**Modify (IDE):**
- `packages/ide/src/hooks/use-debug-transport.ts` — protocol type updates; `applyMessage` handles new `log` message
- `packages/ide/src/store/debug-session.ts` — multi-active state, drop `lastFire`/`recordFire`, per-run `pausedFrame` + `logs`, selectors `selectedRun()` and `nodeStatusesFor()`, runId-keyed step actions
- `packages/ide/src/store/debug-session.test.ts` — multi-active rework
- `packages/ide/src/panels/run-tab/index.tsx` — drop Timeline/RunPicker/StatusBanner; add `<HistoryTable />`
- `packages/ide/src/panels/run-tab/trigger-selector.tsx` — shadcn Select; always-visible
- `packages/ide/src/panels/run-tab/trigger-selector.test.tsx` — updated for always-visible behavior
- `packages/ide/src/panels/run-tab/request-builder.tsx` — `SendButton` rewritten to `fetch`; wires to request-history store
- `packages/ide/src/panels/run-tab/timeline.tsx` — moved to `debug-panel/`; accepts `runId` prop
- `packages/ide/src/panels/run-tab/status-banner.tsx` — moved to `debug-panel/`; accepts `runId` prop
- `packages/ide/src/layout/default-layout.ts` — add `"debug"` pane id
- `packages/ide/src/layout/dock-view.tsx` — register the `debug` component
- `packages/ide/src/workflow/workflow-editor.tsx` — derive node statuses + edge flash from selected run

**Delete (IDE):**
- `packages/ide/src/panels/run-tab/run-picker.tsx` — replaced by Debug-panel runs list
- `packages/ide/src/panels/run-tab/run-picker.test.tsx` (if it exists)

---

## Task 1: Shared cors module + console-capture

**Files:**
- Create: `packages/runtime/src/dev-server/cors.ts`
- Modify: `packages/runtime/src/agent-broker/server.ts` (import the shared helper)
- Create: `packages/runtime/src/dev-server/console-capture.ts`
- Create: `packages/runtime/src/dev-server/console-capture.test.ts`

### Step 1: Create `cors.ts` with the extracted helper

```ts
// packages/runtime/src/dev-server/cors.ts

/**
 * Returns true when the given origin is a loopback URL (localhost / 127.0.0.1 / [::1]).
 * Used to gate dev-only endpoints so the IDE can fetch across origins without
 * exposing them to the wider web.
 */
export function isLoopbackOriginString(origin: string | undefined | null): boolean {
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
```

### Step 2: Update `agent-broker/server.ts` to import from the new module

Read `packages/runtime/src/agent-broker/server.ts` lines ~37-49 (the existing `isLoopbackOriginString` function). Delete that declaration. Add an import near the top:

```ts
import { isLoopbackOriginString } from "../dev-server/cors.js"
```

### Step 3: Write failing tests for `console-capture`

`packages/runtime/src/dev-server/console-capture.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { installConsoleCapture, withRunContext } from "./console-capture.js"

describe("console-capture", () => {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  }

  afterEach(() => {
    console.log = original.log
    console.info = original.info
    console.warn = original.warn
    console.error = original.error
  })

  it("captures console.log inside withRunContext with the runId", () => {
    const captured: Array<{ runId: string; level: string; message: string }> = []
    installConsoleCapture((e) => captured.push(e))

    void withRunContext("r1", async () => {
      console.log("hello", 42)
    })
    // Allow the microtask to settle
    return new Promise<void>((resolve) =>
      queueMicrotask(() => {
        expect(captured).toEqual([
          { runId: "r1", level: "log", message: "hello 42" },
        ])
        resolve()
      }),
    )
  })

  it("captures info / warn / error levels", async () => {
    const captured: Array<{ level: string; message: string }> = []
    installConsoleCapture(({ level, message }) => captured.push({ level, message }))

    await withRunContext("r1", async () => {
      console.info("i")
      console.warn("w")
      console.error("e")
    })
    expect(captured.map((c) => c.level)).toEqual(["info", "warn", "error"])
  })

  it("logs outside any run context fall through to original (no capture)", () => {
    const captured: Array<unknown> = []
    installConsoleCapture((e) => captured.push(e))
    // Replace console.log to spy, then log outside context
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    console.log("nope")
    // captured should NOT have an entry from this call
    expect(captured.length).toBe(0)
    logSpy.mockRestore()
  })

  it("formats Error arguments using their stack", async () => {
    const captured: Array<{ message: string }> = []
    installConsoleCapture(({ message }) => captured.push({ message }))
    await withRunContext("r1", async () => {
      console.log(new Error("boom"))
    })
    expect(captured[0]?.message).toMatch(/boom/)
    // Stack typically includes "Error: boom"
    expect(captured[0]?.message).toMatch(/Error: boom/)
  })

  it("propagates through await", async () => {
    const captured: Array<{ runId: string }> = []
    installConsoleCapture(({ runId }) => captured.push({ runId }))
    await withRunContext("r1", async () => {
      await new Promise((r) => setTimeout(r, 1))
      console.log("after-await")
    })
    expect(captured).toEqual([{ runId: "r1" }])
  })

  it("isolates concurrent contexts", async () => {
    const captured: Array<{ runId: string; message: string }> = []
    installConsoleCapture(({ runId, message }) => captured.push({ runId, message }))

    const a = withRunContext("a", async () => {
      await new Promise((r) => setTimeout(r, 5))
      console.log("from-a")
    })
    const b = withRunContext("b", async () => {
      await new Promise((r) => setTimeout(r, 2))
      console.log("from-b")
    })
    await Promise.all([a, b])
    // Order may vary but each message must be tagged with its own runId
    expect(captured.find((c) => c.message === "from-a")?.runId).toBe("a")
    expect(captured.find((c) => c.message === "from-b")?.runId).toBe("b")
  })
})
```

### Step 4: Verify FAIL

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test console-capture -- --run 2>&1 | tail -20
```

Expected: FAIL — module not found.

### Step 5: Implement `console-capture.ts`

```ts
// packages/runtime/src/dev-server/console-capture.ts
import { AsyncLocalStorage } from "node:async_hooks"

interface RunContext {
  runId: string
}

const runContext = new AsyncLocalStorage<RunContext>()

let installed = false
let handler:
  | ((e: { runId: string; level: "log" | "info" | "warn" | "error"; message: string }) => void)
  | null = null

export function installConsoleCapture(
  onLog: NonNullable<typeof handler>,
): void {
  handler = onLog
  if (installed) return
  installed = true
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  }
  const levels = ["log", "info", "warn", "error"] as const
  for (const level of levels) {
    console[level] = (...args: unknown[]) => {
      const ctx = runContext.getStore()
      if (ctx && handler) {
        const message = args.map(formatArg).join(" ")
        handler({ runId: ctx.runId, level, message })
      }
      original[level](...args)
    }
  }
}

export function withRunContext<T>(
  runId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runContext.run({ runId }, fn)
}

function formatArg(a: unknown): string {
  if (a instanceof Error) return a.stack ?? a.message
  if (typeof a === "string") return a
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}
```

### Step 6: Verify PASS

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test console-capture cors agent-broker -- --run 2>&1 | tail -25
```

Expected: console-capture tests green; agent-broker tests still green (the extracted helper behaves identically).

### Step 7: Run full runtime suite + typecheck

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test 2>&1 | tail -15
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime typecheck 2>&1 | tail -10
```

### Step 8: Commit

```bash
git add packages/runtime/src/dev-server/cors.ts packages/runtime/src/dev-server/console-capture.ts packages/runtime/src/dev-server/console-capture.test.ts packages/runtime/src/agent-broker/server.ts
git commit -m "feat(runtime): shared cors helper + console-capture module

cors.ts: extracts isLoopbackOriginString from agent-broker/server.ts
into a shared dev-server module. agent-broker now imports from it.

console-capture.ts: AsyncLocalStorage-based runId tagging for
console.{log,info,warn,error} calls. Logs outside a run context
fall through to the original console (no capture). Propagates
through await, Promise.then, and Node timers per ALS semantics.
Used by the IDE dev server to broadcast log messages over the
debug WebSocket.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Protocol types update

**Files:**
- Modify: `packages/runtime/src/dev-server/debug-protocol.ts`

This task only changes the type file. Subsequent tasks update the runtime and IDE callers to match. Expect the runtime/IDE typecheck to FAIL after this task — that's intentional; Tasks 3-7 fix it.

### Step 1: Rewrite the protocol types

Replace the contents of `packages/runtime/src/dev-server/debug-protocol.ts` with:

```ts
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

/** Used by the IDE to record what was fired; no longer appears on the wire. */
export interface RequestEnvelope {
  method: string
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
}

/** Wire-friendly version of LifecycleEvent: Error is serialized to {message, stack?}. */
export type WireLifecycleEvent =
  | { type: "before-node"; nodeId: string; input: Record<string, unknown> }
  | {
      type: "after-node"
      nodeId: string
      output: Record<string, unknown>
      durationMs: number
    }
  | { type: "edge-fired"; from: string; to: string; value: unknown }
  | {
      type: "error"
      nodeId: string
      error: { message: string; stack?: string }
    }
  | { type: "complete"; totalMs: number }

export type ClientMessage =
  | { type: "hello"; breakpoints: Breakpoint[] }
  | { type: "set-breakpoints"; breakpoints: Breakpoint[] }
  | { type: "continue"; runId: string }
  | { type: "step"; runId: string }
  | { type: "step-over"; runId: string }
  | { type: "stop"; runId: string }

export type ServerMessage =
  | { type: "ready"; sessionId: string }
  | {
      type: "event"
      runId: string
      event: WireLifecycleEvent
      offsetMs: number
    }
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
  | {
      type: "run-error"
      runId: string
      nodeId?: string
      message: string
      stack?: string
    }
  | {
      type: "log"
      runId: string
      level: "log" | "info" | "warn" | "error"
      message: string
      offsetMs: number
    }
  | { type: "ack"; for: ClientMessage["type"] }

// LifecycleEvent is exported back through index.ts for the runtime side; types
// here are wire-only.
export type { LifecycleEvent }
```

### Step 2: Typecheck (expected to FAIL across consumers)

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime typecheck 2>&1 | tail -30
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -30
```

Expected: errors in `debug-session.ts` (fire/replay branches), `use-debug-transport.ts` (typed message handler), `request-builder.tsx` (fire send). Don't commit yet — these will be fixed in tasks 3+ as part of one commit.

### Step 3: Commit deferred — this task ends without a commit

Don't commit `debug-protocol.ts` alone. The protocol break propagates to runtime + IDE; combine with Task 3's commit (DebugSession rewrite) which also touches the IDE consumers in the same commit.

**Note for the implementer:** Leave the file modified and uncommitted. Task 3 will `git add` it together with the rest.

---

## Task 3: `DebugSession` multi-active rewrite + drop fire/replay handlers

**Files:**
- Modify: `packages/runtime/src/dev-server/debug-session.ts`
- Modify: `packages/runtime/src/dev-server/debug-session.test.ts`

Rewrites the state machine for multi-active runs. Deletes `runFire`, the WS `fire`/`replay` handlers, and the single-global `activePause`/`stepMode` fields.

### Step 1: Replace `debug-session.ts` with the multi-active implementation

```ts
// packages/runtime/src/dev-server/debug-session.ts
import type { WebSocket } from "ws"
import type {
  Breakpoint,
  ClientMessage,
  ServerMessage,
} from "./debug-protocol.js"

interface PauseFrame {
  runId: string
  nodeId: string
  phase: "before" | "after"
}

interface RunDebugState {
  runId: string
  workflowPath: string
  startedAt: number
  pause: {
    resolve: () => void
    reject: (err: Error) => void
    frame: PauseFrame
  } | null
  stepMode: "none" | "step" | "step-over"
  stepOverNodeId: string | null
}

class AbortError extends Error {
  override name = "AbortError"
}

export class DebugSession {
  private breakpoints = new Map<string, Breakpoint[]>()
  private clients = new Set<WebSocket>()
  private runs = new Map<string, RunDebugState>()

  get clientCount(): number {
    return this.clients.size
  }

  getBreakpoints(workflowPath: string): Breakpoint[] {
    return this.breakpoints.get(workflowPath) ?? []
  }

  getRunStartedAt(runId: string): number | null {
    return this.runs.get(runId)?.startedAt ?? null
  }

  connect(ws: WebSocket): void {
    this.clients.add(ws)
  }

  disconnect(ws: WebSocket): void {
    this.clients.delete(ws)
    if (this.clients.size === 0) {
      // Reject all active pauses across all runs
      for (const r of this.runs.values()) {
        if (r.pause) {
          r.pause.reject(new AbortError("client disconnected"))
          r.pause = null
        }
        r.stepMode = "none"
        r.stepOverNodeId = null
      }
    }
  }

  broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg)
    for (const ws of this.clients) {
      try {
        ws.send(payload)
      } catch {
        /* dead socket */
      }
    }
  }

  registerRun(
    workflowPath: string,
    runId: string,
    startedAt: number,
  ): {
    onBeforeNode: (nodeId: string, input: Record<string, unknown>) => Promise<void>
    onAfterNode: (nodeId: string, output: Record<string, unknown>) => Promise<void>
  } {
    const state: RunDebugState = {
      runId,
      workflowPath,
      startedAt,
      pause: null,
      stepMode: "none",
      stepOverNodeId: null,
    }
    this.runs.set(runId, state)

    const shouldPause = (
      nodeId: string,
      phase: "before" | "after",
    ): boolean => {
      if (state.stepMode === "step") return true
      const bps = this.breakpoints.get(workflowPath) ?? []
      if (phase === "before") {
        if (
          state.stepMode === "step-over" &&
          state.stepOverNodeId !== nodeId
        )
          return true
        return bps.some((b) => b.nodeId === nodeId && b.kind === "before")
      }
      if (state.stepMode === "step-over" && state.stepOverNodeId === nodeId)
        return false
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
      const frame: PauseFrame = { runId, nodeId, phase }
      this.broadcast({ type: "paused", runId, nodeId, phase, payload })
      return new Promise<void>((resolve, reject) => {
        state.pause = { resolve, reject, frame }
      })
    }

    return {
      onBeforeNode: async (nodeId, input) => {
        if (shouldPause(nodeId, "before")) {
          state.stepMode = "none"
          state.stepOverNodeId = null
          await pause(nodeId, "before", input)
        }
      },
      onAfterNode: async (nodeId, output) => {
        if (shouldPause(nodeId, "after")) {
          state.stepMode = "none"
          state.stepOverNodeId = null
          await pause(nodeId, "after", output)
        }
      },
    }
  }

  unregisterRun(runId: string): void {
    const state = this.runs.get(runId)
    if (state?.pause) {
      // Race: run completed while paused (shouldn't normally happen, but cleanup defensively)
      state.pause.reject(new AbortError("run unregistered while paused"))
    }
    this.runs.delete(runId)
  }

  async onMessage(ws: WebSocket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "hello":
        this.applyBreakpoints(msg.breakpoints)
        ws.send(
          JSON.stringify({
            type: "ready",
            sessionId: this.makeSessionId(),
          } satisfies ServerMessage),
        )
        return
      case "set-breakpoints":
        this.applyBreakpoints(msg.breakpoints)
        ws.send(
          JSON.stringify({
            type: "ack",
            for: "set-breakpoints",
          } satisfies ServerMessage),
        )
        return
      case "continue":
        this.continueRun(msg.runId)
        return
      case "step":
        this.stepRun(msg.runId)
        return
      case "step-over":
        this.stepOverRun(msg.runId)
        return
      case "stop":
        this.stopRun(msg.runId)
        return
    }
  }

  private continueRun(runId: string): void {
    const r = this.runs.get(runId)
    if (!r?.pause) return
    r.pause.resolve()
    r.pause = null
    this.broadcast({ type: "resumed", runId })
  }

  private stepRun(runId: string): void {
    const r = this.runs.get(runId)
    if (!r?.pause) return
    r.stepMode = "step"
    r.pause.resolve()
    r.pause = null
    this.broadcast({ type: "resumed", runId })
  }

  private stepOverRun(runId: string): void {
    const r = this.runs.get(runId)
    if (!r?.pause || r.pause.frame.phase !== "before") return
    r.stepMode = "step-over"
    r.stepOverNodeId = r.pause.frame.nodeId
    r.pause.resolve()
    r.pause = null
    this.broadcast({ type: "resumed", runId })
  }

  private stopRun(runId: string): void {
    const r = this.runs.get(runId)
    if (!r?.pause) return
    r.pause.reject(new AbortError("stopped"))
    r.pause = null
    r.stepMode = "none"
    r.stepOverNodeId = null
  }

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

  // Test-only seam helpers retained for compatibility with existing tests
  _setActivePauseForTest(runId: string, p: RunDebugState["pause"]): void {
    const r = this.runs.get(runId)
    if (r) r.pause = p
  }
  _setStepModeForTest(
    runId: string,
    mode: RunDebugState["stepMode"],
    nodeId: string | null = null,
  ): void {
    const r = this.runs.get(runId)
    if (r) {
      r.stepMode = mode
      r.stepOverNodeId = nodeId
    }
  }
}
```

Notes:
- The `DebugSessionDeps` interface (`getWorkflow`, `getServices`, `resolveNode`) is GONE. The session no longer needs to load workflows or resolve services because it doesn't run anything itself — that responsibility moved to `mountWorkflows`.
- Constructor takes NO arguments now. `new DebugSession()` is the new signature.

### Step 2: Rewrite `debug-session.test.ts`

Replace the existing test file with:

```ts
import { afterEach, describe, expect, it } from "vitest"
import { DebugSession } from "./debug-session.js"
import type { Breakpoint, ServerMessage } from "./debug-protocol.js"

function makeMockClient() {
  const sent: ServerMessage[] = []
  const ws = {
    send: (data: string) => {
      sent.push(JSON.parse(data) as ServerMessage)
    },
    readyState: 1,
    OPEN: 1,
  } as unknown as import("ws").WebSocket
  return { ws, sent }
}

describe("DebugSession multi-active state", () => {
  it("connect/disconnect tracks clients", () => {
    const s = new DebugSession()
    const a = makeMockClient()
    const b = makeMockClient()
    s.connect(a.ws)
    s.connect(b.ws)
    expect(s.clientCount).toBe(2)
    s.disconnect(a.ws)
    expect(s.clientCount).toBe(1)
  })

  it("hello replaces breakpoints and emits ready", async () => {
    const s = new DebugSession()
    const { ws, sent } = makeMockClient()
    s.connect(ws)
    const bps: Breakpoint[] = [
      { workflowPath: "a.workflow", nodeId: "n1", kind: "before" },
    ]
    await s.onMessage(ws, { type: "hello", breakpoints: bps })
    expect(sent.some((m) => m.type === "ready")).toBe(true)
    expect(s.getBreakpoints("a.workflow")).toEqual(bps)
  })

  it("set-breakpoints fully replaces registry", async () => {
    const s = new DebugSession()
    const { ws } = makeMockClient()
    s.connect(ws)
    await s.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [
        { workflowPath: "a", nodeId: "n", kind: "before" },
        { workflowPath: "b", nodeId: "n", kind: "after" },
      ],
    })
    await s.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "a", nodeId: "n2", kind: "before" }],
    })
    expect(s.getBreakpoints("a")).toEqual([
      { workflowPath: "a", nodeId: "n2", kind: "before" },
    ])
    expect(s.getBreakpoints("b")).toEqual([])
  })

  it("registerRun creates a runs map entry; unregister removes it", () => {
    const s = new DebugSession()
    s.registerRun("wf", "r1", 1000)
    expect(s.getRunStartedAt("r1")).toBe(1000)
    s.unregisterRun("r1")
    expect(s.getRunStartedAt("r1")).toBeNull()
  })

  it("before-bp pauses in onBeforeNode for the matching run", async () => {
    const s = new DebugSession()
    const { ws, sent } = makeMockClient()
    s.connect(ws)
    await s.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "wf", nodeId: "X", kind: "before" }],
    })
    const { onBeforeNode } = s.registerRun("wf", "r1", Date.now())
    const pending = onBeforeNode("X", { foo: 1 })
    await new Promise((r) => setTimeout(r, 10))
    expect(
      sent.some(
        (m) =>
          m.type === "paused" &&
          m.runId === "r1" &&
          m.nodeId === "X" &&
          m.phase === "before",
      ),
    ).toBe(true)
    await s.onMessage(ws, { type: "continue", runId: "r1" })
    await pending
  })

  it("port-bp pauses in onAfterNode for the matching run", async () => {
    const s = new DebugSession()
    const { ws, sent } = makeMockClient()
    s.connect(ws)
    await s.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "wf", nodeId: "X", kind: "port:foo" }],
    })
    const { onAfterNode } = s.registerRun("wf", "r1", Date.now())
    const pending = onAfterNode("X", { foo: 1 })
    await new Promise((r) => setTimeout(r, 10))
    expect(
      sent.some(
        (m) => m.type === "paused" && m.runId === "r1" && m.phase === "after",
      ),
    ).toBe(true)
    await s.onMessage(ws, { type: "continue", runId: "r1" })
    await pending
  })

  it("step targets the right run by runId", async () => {
    const s = new DebugSession()
    const { ws, sent } = makeMockClient()
    s.connect(ws)
    const a = s.registerRun("wf", "rA", Date.now())
    const b = s.registerRun("wf", "rB", Date.now())
    // Pause both via 'step' mode
    s._setStepModeForTest("rA", "step")
    s._setStepModeForTest("rB", "step")
    const pendingA = a.onBeforeNode("X", {})
    const pendingB = b.onBeforeNode("Y", {})
    await new Promise((r) => setTimeout(r, 10))
    // Continue rA only
    await s.onMessage(ws, { type: "continue", runId: "rA" })
    await pendingA
    // rB still paused
    expect(sent.filter((m) => m.type === "resumed").map((m) => m.runId)).toContain("rA")
    expect(sent.filter((m) => m.type === "resumed").map((m) => m.runId)).not.toContain("rB")
    await s.onMessage(ws, { type: "continue", runId: "rB" })
    await pendingB
  })

  it("step-over of rA suppresses port-bps on rA but doesn't affect rB", async () => {
    const s = new DebugSession()
    const { ws, sent } = makeMockClient()
    s.connect(ws)
    await s.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "wf", nodeId: "X", kind: "port:p" }],
    })
    const a = s.registerRun("wf", "rA", Date.now())
    const b = s.registerRun("wf", "rB", Date.now())
    s._setStepModeForTest("rA", "step-over", "X")
    // rA's onAfterNode for X must NOT pause
    await a.onAfterNode("X", {})
    expect(
      sent.some(
        (m) => m.type === "paused" && m.runId === "rA" && m.phase === "after",
      ),
    ).toBe(false)
    // rB's onAfterNode for X SHOULD pause (port:p applies to rB)
    const pendingB = b.onAfterNode("X", {})
    await new Promise((r) => setTimeout(r, 10))
    expect(
      sent.some(
        (m) => m.type === "paused" && m.runId === "rB" && m.phase === "after",
      ),
    ).toBe(true)
    await s.onMessage(ws, { type: "continue", runId: "rB" })
    await pendingB
  })

  it("stop rejects only the targeted run's pause with AbortError", async () => {
    const s = new DebugSession()
    const { ws } = makeMockClient()
    s.connect(ws)
    let rejA: unknown = null
    let resolvedB = false
    s.registerRun("wf", "rA", Date.now())
    s.registerRun("wf", "rB", Date.now())
    s._setActivePauseForTest("rA", {
      resolve: () => {},
      reject: (e) => {
        rejA = e
      },
      frame: { runId: "rA", nodeId: "X", phase: "before" },
    })
    s._setActivePauseForTest("rB", {
      resolve: () => {
        resolvedB = true
      },
      reject: () => {},
      frame: { runId: "rB", nodeId: "Y", phase: "before" },
    })
    await s.onMessage(ws, { type: "stop", runId: "rA" })
    expect((rejA as Error).name).toBe("AbortError")
    expect(resolvedB).toBe(false)
  })

  it("disconnect (last client) rejects all active pauses", () => {
    const s = new DebugSession()
    const a = makeMockClient()
    s.connect(a.ws)
    s.registerRun("wf", "rA", Date.now())
    s.registerRun("wf", "rB", Date.now())
    let rejA: unknown = null
    let rejB: unknown = null
    s._setActivePauseForTest("rA", {
      resolve: () => {},
      reject: (e) => {
        rejA = e
      },
      frame: { runId: "rA", nodeId: "X", phase: "before" },
    })
    s._setActivePauseForTest("rB", {
      resolve: () => {},
      reject: (e) => {
        rejB = e
      },
      frame: { runId: "rB", nodeId: "Y", phase: "before" },
    })
    s.disconnect(a.ws)
    expect((rejA as Error).name).toBe("AbortError")
    expect((rejB as Error).name).toBe("AbortError")
  })

  it("continue with unknown runId is a no-op", async () => {
    const s = new DebugSession()
    const { ws, sent } = makeMockClient()
    s.connect(ws)
    await s.onMessage(ws, { type: "continue", runId: "nonexistent" })
    expect(sent.some((m) => m.type === "resumed")).toBe(false)
  })
})
```

### Step 3: Verify tests pass

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test debug-session -- --run 2>&1 | tail -30
```

Expected: 11 tests green. The OLD tests that referenced `fire`/`replay`/`runFire` are gone (this file fully replaces them).

### Step 4: Commit (combined with Task 2's protocol changes)

```bash
git add packages/runtime/src/dev-server/debug-protocol.ts packages/runtime/src/dev-server/debug-session.ts packages/runtime/src/dev-server/debug-session.test.ts
git commit -m "feat(runtime): multi-active DebugSession + protocol with runId-keyed commands

Replaces the single-activePause model with per-run state: each
runId has its own pause, step mode, stepOverNodeId. Commands carry
explicit runId. fire/replay handlers and runFire are deleted entirely
— DebugSession no longer fires workflows; mountWorkflows owns that
in Task 4.

Protocol: continue/step/step-over/stop carry runId. fire/replay
removed. New log server message. run-error gains optional stack.
WireLifecycleEvent serializes Error to {message, stack?}.

DebugSession() constructor takes no arguments (no longer needs
getWorkflow/getServices/resolveNode — the dev-server handler
plumbs those directly).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

The runtime e2e tests will still fail at this point (Task 6 replaces them). Other consumers of the protocol (ide.ts, IDE store) will fail typecheck. Tasks 4-7 fix them.

---

## Task 4: `MountOptions.debug` + handler rewrite

**Files:**
- Modify: `packages/runtime/src/dev-server/server.ts`
- Modify: `packages/runtime/src/dev-server/server.test.ts`

### Step 1: Write failing tests

Append to `packages/runtime/src/dev-server/server.test.ts` (or replace; depending on what's there). Read the file first to see the existing structure.

Add:

```ts
import type { DebugIntegration } from "./server.js"

describe("mountWorkflows with debug integration", () => {
  // Reuse whatever helper the existing tests use to build a tiny workflow.
  // Pseudo-code:
  function buildEchoWorkflow() {
    // ... existing pattern that yields a LoadedWorkflow[] and nodes registry ...
    // The workflow should have a POST /echo trigger that echoes back the request body.
  }

  it("calls debug.newRunId, buildRun, onResult on success", async () => {
    const { workflows, nodes, services } = buildEchoWorkflow()
    const app = new Hono()
    let observedRunId: string | undefined
    let onResultCalled = false
    const debug: DebugIntegration = {
      newRunId: () => {
        observedRunId = "test-run-1"
        return "test-run-1"
      },
      buildRun: () => ({
        lifecycle: new LifecycleEmitter(),
      }),
      onResult: (runId, _result, _totalMs) => {
        if (runId === observedRunId) onResultCalled = true
      },
      onError: () => {},
    }
    mountWorkflows(app, workflows, { nodes, services, debug })
    const res = await app.fetch(
      new Request("http://x/echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ msg: "hi" }),
      }),
    )
    expect(res.status).toBe(200)
    expect(onResultCalled).toBe(true)
  })

  it("calls debug.onError when the workflow throws and returns HTTP 500", async () => {
    const { workflows, nodes, services } = buildThrowingWorkflow() // node calls throw
    const app = new Hono()
    let errMsg = ""
    const debug: DebugIntegration = {
      newRunId: () => "err-run",
      buildRun: () => ({ lifecycle: new LifecycleEmitter() }),
      onResult: () => {},
      onError: (_runId, err) => {
        errMsg = err instanceof Error ? err.message : String(err)
      },
    }
    mountWorkflows(app, workflows, { nodes, services, debug })
    const res = await app.fetch(
      new Request("http://x/throw", { method: "POST" }),
    )
    expect(res.status).toBe(500)
    expect(errMsg).toMatch(/.+/)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/.+/)
  })

  it("works without debug integration (regression guard)", async () => {
    const { workflows, nodes, services } = buildEchoWorkflow()
    const app = new Hono()
    mountWorkflows(app, workflows, { nodes, services })
    const res = await app.fetch(
      new Request("http://x/echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ msg: "hi" }),
      }),
    )
    expect(res.status).toBe(200)
  })
})
```

Read the existing `server.test.ts` first to use the same workflow-building helpers. If `buildEchoWorkflow` and `buildThrowingWorkflow` don't exist, build them inline in this test using the same pattern as other tests in the file.

### Step 2: Verify FAIL

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test server.test -- --run 2>&1 | tail -25
```

Expected: FAIL — `DebugIntegration` type not exported, `debug` option not on MountOptions.

### Step 3: Rewrite `server.ts`

```ts
import type { Context, Hono } from "hono"
import { resolveCoreNode } from "../core/registry.js"
import { LifecycleEmitter } from "../exec/lifecycle.js"
import { runWorkflow, type WorkflowRunResult } from "../exec/run.js"
import { computeExecutionPlan } from "../exec/topology.js"
import type { AnyNodeOrTrigger, Services } from "../types.js"
import { validateWorkflow } from "../workflow/validate.js"
import type { LoadedWorkflow } from "./load.js"
import { buildTriggerSlice, extractParams } from "./trigger-slice.js"
import { withRunContext } from "./console-capture.js"

export interface DebugIntegration {
  newRunId: () => string
  buildRun: (
    runId: string,
    workflowPath: string,
  ) => {
    lifecycle: LifecycleEmitter
    onBeforeNode?: (
      nodeId: string,
      input: Record<string, unknown>,
    ) => Promise<void>
    onAfterNode?: (
      nodeId: string,
      output: Record<string, unknown>,
    ) => Promise<void>
  }
  onResult: (
    runId: string,
    result: WorkflowRunResult,
    totalMs: number,
  ) => void
  onError: (runId: string, err: unknown, totalMs: number) => void
}

export interface MountOptions {
  nodes: Record<string, AnyNodeOrTrigger>
  services: Services
  debug?: DebugIntegration
}

export function mountWorkflows(
  app: Hono,
  workflows: LoadedWorkflow[],
  opts: MountOptions,
): void {
  for (const wf of workflows) {
    const { errors, depsByNode } = validateWorkflow(wf.file)
    if (errors.length > 0) {
      console.error(
        `Skipping ${wf.relativePath}: ${errors.length} validation error(s)`,
      )
      for (const e of errors)
        console.error(`  - ${e.nodeId}.${e.field}: ${e.message}`)
      continue
    }

    for (const [nodeId, inst] of Object.entries(wf.file.nodes)) {
      if (inst.uses !== "@core/http-request") continue
      const values = (inst.values ?? {}) as Record<string, unknown>
      const path = (values.path as string | undefined) ?? "/"
      const method = (
        (values.method as string | undefined) ?? "GET"
      ).toUpperCase()

      const projectedFile = buildTriggerSlice(wf.file, nodeId, depsByNode)
      const { depsByNode: sliceDeps } = validateWorkflow(projectedFile)
      const plan = computeExecutionPlan(projectedFile, sliceDeps)

      const handler = async (c: Context): Promise<Response> => {
        const runId = opts.debug?.newRunId() ?? crypto.randomUUID()
        const startedAt = Date.now()

        // Parse request body / query / headers
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

        try {
          const result = await withRunContext(runId, () =>
            runWorkflow({
              workflow: projectedFile,
              plan,
              triggerNodeId: nodeId,
              triggerOutputs: {
                body,
                params: extractParams(path, url.pathname),
                query,
                headers,
                context: { requestId: runId, timestamp: startedAt },
              },
              services: opts.services,
              resolveNode: (uses) =>
                resolveCoreNode(uses) ?? opts.nodes[uses] ?? null,
              ...(run?.lifecycle ? { lifecycle: run.lifecycle } : {}),
              ...(run?.onBeforeNode ? { onBeforeNode: run.onBeforeNode } : {}),
              ...(run?.onAfterNode ? { onAfterNode: run.onAfterNode } : {}),
            }),
          )
          opts.debug?.onResult(runId, result, Date.now() - startedAt)
          return new Response(JSON.stringify(result.body), {
            status: result.status,
            headers: {
              "content-type": "application/json",
              ...result.headers,
            },
          })
        } catch (err) {
          opts.debug?.onError(runId, err, Date.now() - startedAt)
          const msg = err instanceof Error ? err.message : String(err)
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "content-type": "application/json" },
          })
        }
      }

      app.on(method, path, handler)
    }
  }
}
```

Notes:
- The previous `MountOptions.lifecycle?: LifecycleEmitter` is gone — DebugIntegration's `buildRun().lifecycle` replaces it.
- All paths through the handler are wrapped in `withRunContext(runId, ...)` so any console.* calls (in node `run` functions) are tagged with the runId.

### Step 4: Verify tests pass

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test server.test -- --run 2>&1 | tail -25
```

Expected: green.

### Step 5: Commit

```bash
git add packages/runtime/src/dev-server/server.ts packages/runtime/src/dev-server/server.test.ts
git commit -m "feat(runtime): MountOptions.debug — per-request integration

mountWorkflows handler now generates a runId, builds per-request
lifecycle + hooks via DebugIntegration, wraps runWorkflow in
withRunContext (for console capture), reports result/error back to
the integration, and returns HTTP 500 with {error} body on workflow
throw.

Without opts.debug, the handler runs identically to before
(allocates a runId via crypto.randomUUID() and that's it).

The old opts.lifecycle field is removed — DebugIntegration owns the
lifecycle now.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: `ide.ts` wiring + CORS + console capture install

**Files:**
- Modify: `packages/build/src/commands/ide.ts`

### Step 1: Update `ide.ts` to wire the DebugIntegration

Read `packages/build/src/commands/ide.ts` to locate:
- The existing `DebugSession` construction (where `new DebugSession({...deps...})` is called)
- The existing `attachAgentBroker` + `attachDebugWebSocket` calls
- The `serve(...)` invocation

The current code (per the previous debugger plan, Task 8) constructs a `DebugSession` with `getWorkflow`/`getServices`/`resolveNode` deps. That constructor signature is GONE (DebugSession now takes no args). Update:

```ts
import {
  DebugSession,
  attachDebugWebSocket,
  installConsoleCapture,
  type DebugIntegration,
  LifecycleEmitter,        // re-exported from runtime; verify the import path
} from "@darrylondil/lorien-runtime"
import { cors } from "hono/cors"
import { isLoopbackOriginString } from "@darrylondil/lorien-runtime"  // ensure this is re-exported

// ...inside runIde, after loadedWorkflows + loadedNodes + loadedServices are computed:

const session = new DebugSession()

installConsoleCapture(({ runId, level, message }) => {
  const startedAt = session.getRunStartedAt(runId)
  if (startedAt === null) return
  session.broadcast({
    type: "log",
    runId,
    level,
    message,
    offsetMs: Date.now() - startedAt,
  })
})

const debug: DebugIntegration = {
  newRunId: () => `r-${Math.random().toString(36).slice(2, 10)}`,
  buildRun: (runId, workflowPath) => {
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
        session.broadcast({
          type: "event",
          runId,
          event: wireEvent as never,
          offsetMs: Date.now() - startedAt,
        })
      })
    }
    const { onBeforeNode, onAfterNode } = session.registerRun(
      workflowPath,
      runId,
      startedAt,
    )
    return { lifecycle, onBeforeNode, onAfterNode }
  },
  onResult: (runId, result, totalMs) => {
    session.broadcast({
      type: "run-complete",
      runId,
      status: result.status,
      body: result.body,
      totalMs,
    })
    session.unregisterRun(runId)
  },
  onError: (runId, err, totalMs) => {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    const nodeId =
      err && typeof err === "object" && "nodeId" in err
        ? ((err as { nodeId: unknown }).nodeId as string | undefined)
        : undefined
    session.broadcast({
      type: "run-error",
      runId,
      ...(nodeId !== undefined ? { nodeId } : {}),
      message,
      ...(stack !== undefined ? { stack } : {}),
    })
    session.unregisterRun(runId)
    void totalMs
  },
}

// CORS for all routes (loopback-only) — must be set up BEFORE mountWorkflows
app.use(
  "*",
  cors({
    origin: (origin) => (isLoopbackOriginString(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "authorization"],
  }),
)

mountWorkflows(app, loadedWorkflows, {
  nodes: loadedNodes,
  services: loadedServices,
  debug,
})

// ...later, after serve(...) returns the server:
attachDebugWebSocket({ app, server: httpServer, session })
```

Delete any code that referenced the old `DebugSession({ getWorkflow, getServices, resolveNode })` constructor, the old `MountOptions.lifecycle`, or any lifecycle-emitter plumbing that's now owned by the integration's `buildRun`.

Update `packages/runtime/src/index.ts` so the IDE can import everything it needs:

```ts
export { installConsoleCapture, withRunContext } from "./dev-server/console-capture.js"
export { isLoopbackOriginString } from "./dev-server/cors.js"
export type { DebugIntegration } from "./dev-server/server.js"
export { LifecycleEmitter } from "./exec/lifecycle.js"  // if not already
// Protocol types — ensure all the new ones are re-exported:
export type {
  Breakpoint,
  ClientMessage,
  ServerMessage,
  RequestEnvelope,
  WireLifecycleEvent,
} from "./dev-server/debug-protocol.js"
```

Check the existing index.ts to avoid duplicating an `export type` that's already present.

### Step 2: Run all build + runtime tests

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-build test 2>&1 | tail -15
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test 2>&1 | tail -15
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-build typecheck 2>&1 | tail -10
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime typecheck 2>&1 | tail -10
```

Expected: all green. The runtime e2e test will still fail — that's replaced in Task 6.

### Step 3: Commit

```bash
git add packages/build/src/commands/ide.ts packages/runtime/src/index.ts
git commit -m "feat(build): wire DebugIntegration into the IDE dev command

DebugSession() constructor is now arg-free. installConsoleCapture
broadcasts node console.* calls as log messages over WS. CORS is
applied to all routes (loopback-only) so the IDE can fetch workflow
endpoints across the Vite dev port. mountWorkflows receives the
DebugIntegration factory (newRunId, buildRun, onResult, onError);
attachDebugWebSocket wires the WS endpoint to the same session.

Old DebugSession({getWorkflow,getServices,resolveNode}) wiring is
gone — the session no longer fires workflows, mountWorkflows does.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Replace the runtime e2e test

**Files:**
- Modify: `packages/runtime/src/dev-server/debug-e2e.test.ts` (full replacement)

### Step 1: Replace the test file

Replace the contents of `packages/runtime/src/dev-server/debug-e2e.test.ts` with:

```ts
import { createServer, type Server as HttpServer } from "node:http"
import { describe, expect, it } from "vitest"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { WebSocket } from "ws"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { LifecycleEmitter } from "../exec/lifecycle.js"
import { DebugSession } from "./debug-session.js"
import { attachDebugWebSocket } from "./debug-ws.js"
import { mountWorkflows, type DebugIntegration } from "./server.js"
import {
  installConsoleCapture,
  withRunContext,
} from "./console-capture.js"
import { isLoopbackOriginString } from "./cors.js"
import type { ServerMessage } from "./debug-protocol.js"
import type { LoadedWorkflow } from "./load.js"

function startServerWithDebug(): Promise<{
  server: HttpServer
  port: number
  session: DebugSession
}> {
  // Tiny workflow: POST /echo → echo node → response
  const echoNode = defineNode({
    name: "echo",
    inputs: z.object({ msg: z.string() }),
    outputs: z.object({ msg: z.string() }),
    async run({ msg }) {
      console.log("echo node ran with msg:", msg)
      return { msg }
    },
  })
  const wf: LoadedWorkflow = {
    relativePath: "workflows/echo.workflow",
    file: {
      lorien: 1 as const,
      nodes: {
        request: {
          uses: "@core/http-request" as const,
          values: { method: "POST", path: "/echo" },
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
    },
  } as unknown as LoadedWorkflow

  const app = new Hono()
  const session = new DebugSession()

  installConsoleCapture(({ runId, level, message }) => {
    const startedAt = session.getRunStartedAt(runId)
    if (startedAt === null) return
    session.broadcast({
      type: "log",
      runId,
      level,
      message,
      offsetMs: Date.now() - startedAt,
    })
  })

  const debug: DebugIntegration = {
    newRunId: () => `r-${Math.random().toString(36).slice(2, 10)}`,
    buildRun: (runId, workflowPath) => {
      const startedAt = Date.now()
      const lifecycle = new LifecycleEmitter()
      for (const t of [
        "before-node",
        "after-node",
        "edge-fired",
        "error",
        "complete",
      ] as const) {
        lifecycle.on(t, (ev) =>
          session.broadcast({
            type: "event",
            runId,
            event: ev as never,
            offsetMs: Date.now() - startedAt,
          }),
        )
      }
      const { onBeforeNode, onAfterNode } = session.registerRun(
        workflowPath,
        runId,
        startedAt,
      )
      return { lifecycle, onBeforeNode, onAfterNode }
    },
    onResult: (runId, result, totalMs) => {
      session.broadcast({
        type: "run-complete",
        runId,
        status: result.status,
        body: result.body,
        totalMs,
      })
      session.unregisterRun(runId)
    },
    onError: (runId, err, totalMs) => {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      session.broadcast({
        type: "run-error",
        runId,
        message,
        ...(stack ? { stack } : {}),
      })
      session.unregisterRun(runId)
      void totalMs
    },
  }

  app.use(
    "*",
    cors({
      origin: (origin) =>
        isLoopbackOriginString(origin) ? origin : null,
      allowMethods: ["POST", "GET"],
      allowHeaders: ["content-type"],
    }),
  )

  mountWorkflows(app, [wf], {
    nodes: { "./nodes/echo": echoNode },
    services: {} as never,
    debug,
  })

  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = `http://${req.headers.host}${req.url ?? "/"}`
      const init: RequestInit = { method: req.method ?? "GET", headers: req.headers as Record<string, string> }
      if (req.method && req.method !== "GET" && req.method !== "HEAD") {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        init.body = Buffer.concat(chunks) as unknown as BodyInit
      }
      const r = await app.fetch(new Request(url, init))
      res.writeHead(r.status, Object.fromEntries(r.headers.entries()))
      res.end(await r.text())
    })
    attachDebugWebSocket({ app, server, session })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({ server, port, session })
    })
  })
}

describe("debugger HTTP-driven e2e", () => {
  it("set-breakpoints + HTTP fire + pause + continue + run-complete", async () => {
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
    await new Promise((r) => setTimeout(r, 30))

    // Fire via HTTP
    const httpResPromise = fetch(`http://127.0.0.1:${port}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: JSON.stringify({ msg: "hi" }),
    })

    await new Promise((r) => setTimeout(r, 80))
    const paused = received.find((m) => m.type === "paused")
    expect(paused).toBeTruthy()
    const pausedRunId = (paused as Extract<ServerMessage, { type: "paused" }>).runId

    ws.send(JSON.stringify({ type: "continue", runId: pausedRunId }))
    const httpRes = await httpResPromise
    expect(httpRes.status).toBe(200)
    const body = (await httpRes.json()) as string
    expect(body).toBe("hi")

    await new Promise((r) => setTimeout(r, 30))
    const complete = received.find((m) => m.type === "run-complete")
    expect(complete).toBeTruthy()

    // The echo node calls console.log; expect a corresponding `log` message
    const log = received.find((m) => m.type === "log")
    expect(log).toBeTruthy()
    expect((log as Extract<ServerMessage, { type: "log" }>).message).toMatch(/echo node ran/)

    ws.close()
    server.close()
  })

  it("two concurrent HTTP requests pause and step independently", async () => {
    const { server, port } = await startServerWithDebug()
    const ws = new WebSocket(`ws://127.0.0.1:${port}/__lorien/debug/ws`, {
      headers: { origin: "http://localhost:5173" },
    })
    const received: ServerMessage[] = []
    await new Promise<void>((resolve) => ws.on("open", () => resolve()))
    ws.on("message", (raw) => received.push(JSON.parse(raw.toString()) as ServerMessage))

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
    await new Promise((r) => setTimeout(r, 30))

    const fire = (msg: string) =>
      fetch(`http://127.0.0.1:${port}/echo`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:5173" },
        body: JSON.stringify({ msg }),
      })
    const p1 = fire("first")
    const p2 = fire("second")
    await new Promise((r) => setTimeout(r, 80))
    const pausedRunIds = received
      .filter((m) => m.type === "paused")
      .map((m) => (m as Extract<ServerMessage, { type: "paused" }>).runId)
    expect(pausedRunIds.length).toBe(2)
    // Continue both independently
    for (const id of pausedRunIds) {
      ws.send(JSON.stringify({ type: "continue", runId: id }))
    }
    await Promise.all([p1, p2])
    ws.close()
    server.close()
  })
})
```

### Step 2: Verify PASS

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test debug-e2e -- --run 2>&1 | tail -30
```

Expected: both tests green.

### Step 3: Run the full runtime suite

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-runtime test 2>&1 | tail -15
```

Expected: green.

### Step 4: Commit

```bash
git add packages/runtime/src/dev-server/debug-e2e.test.ts
git commit -m "test(runtime): HTTP-driven debugger end-to-end

Replaces the WS-fire e2e with the new HTTP path. Two scenarios:
single request that pauses at a breakpoint + resumes via runId-keyed
continue + completes; and two concurrent HTTP requests that both
pause and step independently. Also asserts log message arrival from
a node's console.log.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: IDE store + transport updates

**Files:**
- Modify: `packages/ide/src/store/debug-session.ts`
- Modify: `packages/ide/src/store/debug-session.test.ts`
- Modify: `packages/ide/src/hooks/use-debug-transport.ts`

### Step 1: Rewrite `debug-session.ts` for multi-active state

Big rewrite. Top-of-file changes:
- Remove `lastFire` field
- Remove `recordFire` action
- Remove top-level `pausedFrame`, `nodeStatuses`, `status` fields — derived per-run instead
- `RunRecord` gains `pausedFrame?: PausedFrame` and `logs: LogEntry[]`
- `RunRecord.outcome` adds `kind: "paused"` and `kind: "errored"` so a single source of truth holds the per-run state
- Add `selectedRun()` and `nodeStatusesFor(runId)` selectors
- Add `sendContinue(runId)`, `sendStep(runId)`, `sendStepOver(runId)`, `sendStop(runId)` actions — these construct messages but the actual `send` is done via the transport hook (not by the store directly). Two options: (a) the store owns a `wsSend` callback set by the transport hook on mount; (b) the actions return messages and components route through the transport's `send`. We'll go with (a) for ergonomics.
- The action signature for `applyMessage` is unchanged; switch cases adapt to new ServerMessage shapes
- New action `setWsSender(send: (msg: ClientMessage) => void)` — called once by useDebugTransport on mount

Full replacement file:

```ts
import { create } from "zustand"
import type {
  Breakpoint,
  ClientMessage,
  RequestEnvelope,
  ServerMessage,
  WireLifecycleEvent,
} from "@darrylondil/lorien-runtime"
import {
  loadBreakpoints,
  saveBreakpoints,
} from "./debug-breakpoints-storage"

export type NodeStatus = "running" | "completed" | "errored" | "paused"

export interface TimelineEvent {
  offsetMs: number
  event: WireLifecycleEvent
}

export interface LogEntry {
  offsetMs: number
  level: "log" | "info" | "warn" | "error"
  message: string
}

export interface PausedFrame {
  nodeId: string
  phase: "before" | "after"
  payload: unknown
}

export interface RunRecord {
  runId: string
  workflowPath: string
  triggerNodeId: string
  request: RequestEnvelope
  startedAt: number
  events: TimelineEvent[]
  logs: LogEntry[]
  pausedFrame: PausedFrame | null
  outcome:
    | { kind: "running" }
    | { kind: "paused" }
    | { kind: "ok"; status: number; body: unknown; totalMs: number }
    | {
        kind: "errored"
        nodeId?: string
        message: string
        stack?: string
        totalMs?: number
      }
}

interface DebugSessionState {
  connected: boolean
  runs: RunRecord[] // newest first; cap 20
  selectedRunId: string | null
  breakpoints: Breakpoint[]

  // intents
  setConnected: (v: boolean) => void
  setWsSender: (send: (msg: ClientMessage) => void) => void
  applyMessage: (msg: ServerMessage) => void
  selectRun: (runId: string) => void
  toggleBreakpoint: (bp: Breakpoint) => void
  setBreakpoints: (bps: Breakpoint[]) => void
  hydrateBreakpoints: () => void

  sendContinue: (runId: string) => void
  sendStep: (runId: string) => void
  sendStepOver: (runId: string) => void
  sendStop: (runId: string) => void

  // upsertRunFromIdeFire: called by SendButton at the moment of HTTP fire
  // so the Debug panel can show "in-flight" even before any WS event arrives
  // Returns the local runId placeholder used until the server assigns one.
  upsertRunFromIdeFire: (
    workflowPath: string,
    triggerNodeId: string,
    request: RequestEnvelope,
  ) => void

  // selectors
  selectedRun: () => RunRecord | null
  nodeStatusesFor: (runId: string | null) => Map<string, NodeStatus>

  getInitialState: () => Omit<
    DebugSessionState,
    "setConnected" | "setWsSender" | "applyMessage" | "selectRun" | "toggleBreakpoint" | "setBreakpoints" | "hydrateBreakpoints" | "sendContinue" | "sendStep" | "sendStepOver" | "sendStop" | "upsertRunFromIdeFire" | "selectedRun" | "nodeStatusesFor" | "getInitialState"
  >
}

const initialData = {
  connected: false,
  runs: [] as RunRecord[],
  selectedRunId: null as string | null,
  breakpoints: [] as Breakpoint[],
}

let wsSender: ((msg: ClientMessage) => void) | null = null

export const useDebugSessionStore = create<DebugSessionState>((set, get) => ({
  ...initialData,

  getInitialState: () => ({ ...initialData }),

  setConnected: (v) => set({ connected: v }),
  setWsSender: (send) => {
    wsSender = send
  },

  applyMessage: (msg) => {
    switch (msg.type) {
      case "ready":
        set({ connected: true })
        return
      case "event": {
        const { runId, event, offsetMs } = msg
        set((s) => {
          let runs = s.runs
          // Lazy-create run record if unknown — this happens when external
          // HTTP traffic hits the server.
          if (!runs.find((r) => r.runId === runId)) {
            const record: RunRecord = {
              runId,
              workflowPath: "",      // unknown for external traffic
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
          runs = runs.map((r) =>
            r.runId === runId
              ? { ...r, events: [...r.events, { offsetMs, event }] }
              : r,
          )
          return { runs, selectedRunId: s.selectedRunId ?? runId }
        })
        return
      }
      case "log": {
        const { runId, level, message, offsetMs } = msg
        set((s) => ({
          runs: s.runs.map((r) =>
            r.runId === runId
              ? { ...r, logs: [...r.logs, { offsetMs, level, message }] }
              : r,
          ),
        }))
        return
      }
      case "paused": {
        set((s) => ({
          runs: s.runs.map((r) =>
            r.runId === msg.runId
              ? {
                  ...r,
                  pausedFrame: {
                    nodeId: msg.nodeId,
                    phase: msg.phase,
                    payload: msg.payload,
                  },
                  outcome: { kind: "paused" },
                }
              : r,
          ),
        }))
        return
      }
      case "resumed":
        set((s) => ({
          runs: s.runs.map((r) =>
            r.runId === msg.runId
              ? { ...r, pausedFrame: null, outcome: { kind: "running" } }
              : r,
          ),
        }))
        return
      case "run-complete":
        set((s) => ({
          runs: s.runs.map((r) =>
            r.runId === msg.runId
              ? {
                  ...r,
                  pausedFrame: null,
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
          runs: s.runs.map((r) =>
            r.runId === msg.runId
              ? {
                  ...r,
                  pausedFrame: null,
                  outcome: {
                    kind: "errored",
                    ...(msg.nodeId !== undefined ? { nodeId: msg.nodeId } : {}),
                    message: msg.message,
                    ...(msg.stack !== undefined ? { stack: msg.stack } : {}),
                  },
                }
              : r,
          ),
        }))
        return
      case "ack":
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

  sendContinue: (runId) => wsSender?.({ type: "continue", runId }),
  sendStep: (runId) => wsSender?.({ type: "step", runId }),
  sendStepOver: (runId) => wsSender?.({ type: "step-over", runId }),
  sendStop: (runId) => wsSender?.({ type: "stop", runId }),

  upsertRunFromIdeFire: (workflowPath, triggerNodeId, request) => {
    // The IDE doesn't know the server-assigned runId yet. We don't create a
    // placeholder record — the first inbound `event` will lazy-create with
    // limited info. The Run-tab history table is the authoritative IDE-side
    // record of what was fired (the Debug panel's runs list mirrors the
    // server view).
    // This function is a hook point for future enhancements (e.g. surface
    // "pending" state in the Debug panel before the first event arrives).
    void workflowPath
    void triggerNodeId
    void request
  },

  selectedRun: () => {
    const s = get()
    return s.runs.find((r) => r.runId === s.selectedRunId) ?? null
  },

  nodeStatusesFor: (runId) => {
    if (!runId) return new Map<string, NodeStatus>()
    const s = get()
    const run = s.runs.find((r) => r.runId === runId)
    if (!run) return new Map<string, NodeStatus>()
    const statuses = new Map<string, NodeStatus>()
    for (const e of run.events) {
      if (e.event.type === "before-node") statuses.set(e.event.nodeId, "running")
      else if (e.event.type === "after-node") statuses.set(e.event.nodeId, "completed")
      else if (e.event.type === "error") statuses.set(e.event.nodeId, "errored")
    }
    if (run.pausedFrame) statuses.set(run.pausedFrame.nodeId, "paused")
    return statuses
  },
}))
```

### Step 2: Rewrite `debug-session.test.ts` (IDE side)

Replace the existing test file with tests targeting the new shape. Key cases:

```ts
import { afterEach, describe, expect, it } from "vitest"
import { useDebugSessionStore } from "./debug-session"
import type { ServerMessage } from "@darrylondil/lorien-runtime"

describe("useDebugSessionStore", () => {
  afterEach(() => {
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState())
    localStorage.clear()
  })

  it("starts with no connection, no runs, no breakpoints", () => {
    const s = useDebugSessionStore.getState()
    expect(s.connected).toBe(false)
    expect(s.runs).toEqual([])
    expect(s.selectedRunId).toBeNull()
    expect(s.breakpoints).toEqual([])
  })

  it("applyMessage(ready) sets connected", () => {
    useDebugSessionStore.getState().applyMessage({ type: "ready", sessionId: "s1" } as ServerMessage)
    expect(useDebugSessionStore.getState().connected).toBe(true)
  })

  it("event for unknown runId lazy-creates a run record", () => {
    useDebugSessionStore.getState().applyMessage({
      type: "event",
      runId: "rA",
      event: { type: "before-node", nodeId: "n1", input: {} },
      offsetMs: 0,
    } as ServerMessage)
    expect(useDebugSessionStore.getState().runs[0]?.runId).toBe("rA")
  })

  it("paused message sets the matching run's pausedFrame and outcome=paused", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "paused", runId: "rA", nodeId: "x", phase: "before", payload: { foo: 1 } } as ServerMessage)
    const r = useDebugSessionStore.getState().runs[0]!
    expect(r.pausedFrame?.nodeId).toBe("x")
    expect(r.outcome.kind).toBe("paused")
  })

  it("resumed clears pausedFrame on the matching run only", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "event", runId: "rB", event: { type: "before-node", nodeId: "y", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "paused", runId: "rA", nodeId: "x", phase: "before", payload: null } as ServerMessage)
    s.applyMessage({ type: "paused", runId: "rB", nodeId: "y", phase: "before", payload: null } as ServerMessage)
    s.applyMessage({ type: "resumed", runId: "rA" } as ServerMessage)
    const runs = useDebugSessionStore.getState().runs
    expect(runs.find((r) => r.runId === "rA")?.pausedFrame).toBeNull()
    expect(runs.find((r) => r.runId === "rB")?.pausedFrame).not.toBeNull()
  })

  it("log appends to the matching run's logs", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "log", runId: "rA", level: "info", message: "hello", offsetMs: 5 } as ServerMessage)
    const r = useDebugSessionStore.getState().runs[0]!
    expect(r.logs).toEqual([{ offsetMs: 5, level: "info", message: "hello" }])
  })

  it("run-complete sets outcome.ok", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "run-complete", runId: "rA", status: 200, body: { ok: true }, totalMs: 42 } as ServerMessage)
    const r = useDebugSessionStore.getState().runs[0]!
    expect(r.outcome).toEqual({ kind: "ok", status: 200, body: { ok: true }, totalMs: 42 })
  })

  it("run-error sets outcome.errored with optional stack and nodeId", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "run-error", runId: "rA", nodeId: "saveUser", message: "boom", stack: "Error: boom\n  at ..." } as ServerMessage)
    const r = useDebugSessionStore.getState().runs[0]!
    expect(r.outcome.kind).toBe("errored")
    if (r.outcome.kind === "errored") {
      expect(r.outcome.message).toBe("boom")
      expect(r.outcome.nodeId).toBe("saveUser")
      expect(r.outcome.stack).toMatch(/Error: boom/)
    }
  })

  it("selectedRun returns the focused run or null", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.selectRun("rA")
    expect(useDebugSessionStore.getState().selectedRun()?.runId).toBe("rA")
  })

  it("nodeStatusesFor reflects the run's events + pause", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "event", runId: "rA", event: { type: "after-node", nodeId: "x", output: {}, durationMs: 1 }, offsetMs: 1 } as ServerMessage)
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "y", input: {} }, offsetMs: 2 } as ServerMessage)
    s.applyMessage({ type: "paused", runId: "rA", nodeId: "y", phase: "before", payload: null } as ServerMessage)
    const statuses = useDebugSessionStore.getState().nodeStatusesFor("rA")
    expect(statuses.get("x")).toBe("completed")
    expect(statuses.get("y")).toBe("paused")
  })

  it("retains at most 20 runs", () => {
    const s = useDebugSessionStore.getState()
    for (let i = 0; i < 22; i++) {
      s.applyMessage({ type: "event", runId: `r${i}`, event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    }
    expect(useDebugSessionStore.getState().runs.length).toBe(20)
  })
})
```

### Step 3: Update `use-debug-transport.ts`

Read the existing file; locate the `applyMessage` dispatch and the outgoing message construction. Changes:

- Imports stay the same (`ClientMessage`, `ServerMessage`).
- On WS open, after the existing `hello` send, also call `useDebugSessionStore.getState().setWsSender(send)` so the store's `sendContinue`/etc. actions work. Actually — `setWsSender` should be called even before WS open so the store can buffer or just no-op until ready. Call it from inside the hook setup, BEFORE the WS opens:

```ts
useDebugSessionStore.getState().setWsSender((msg) => {
  // send only if open
  const cur = singleton?.ws
  if (cur?.readyState === WebSocket.OPEN) cur.send(JSON.stringify(msg))
})
```

The rest of the hook (singleton, refCount, reconnect backoff) stays as-is from the previous Task 11 implementation.

### Step 4: Verify tests pass + typecheck

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test debug-session use-debug-transport -- --run 2>&1 | tail -30
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -15
```

Expected: green. Some existing tests in OTHER files may now fail because they reference removed APIs (`recordFire`, `lastFire`, etc.). Those are fixed in Task 9.

### Step 5: Commit

```bash
git add packages/ide/src/store/debug-session.ts packages/ide/src/store/debug-session.test.ts packages/ide/src/hooks/use-debug-transport.ts
git commit -m "refactor(ide): debug-session store goes multi-active; drops recordFire/lastFire

Per-run state lives on each RunRecord (pausedFrame, logs, outcome).
Top-level pausedFrame/nodeStatuses/status are gone — components
derive from the selected run via selectedRun() and nodeStatusesFor().

Step actions take runId. The store holds a wsSender callback that
the transport hook installs on mount; the sendContinue/sendStep
actions delegate through it.

The log ServerMessage type appends to the matching run's logs.
run-error and event(error) carry optional stack traces.

Cap raised from 10 to 20.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Request-history store

**Files:**
- Create: `packages/ide/src/store/request-history.ts`
- Create: `packages/ide/src/store/request-history.test.ts`

### Step 1: Write failing tests

```ts
// packages/ide/src/store/request-history.test.ts
import { afterEach, describe, expect, it } from "vitest"
import { useRequestHistoryStore } from "./request-history"

describe("useRequestHistoryStore", () => {
  afterEach(() => {
    useRequestHistoryStore.setState({ entries: [] })
  })

  it("addEntry returns an id and stores an in-flight entry", () => {
    const id = useRequestHistoryStore.getState().addEntry({
      workflowPath: "wf",
      triggerNodeId: "req",
      request: { method: "POST", path: "/x" },
      startedAt: 1000,
    })
    expect(id).toBeTruthy()
    const entry = useRequestHistoryStore.getState().entries[0]!
    expect(entry.id).toBe(id)
    expect(entry.outcome.kind).toBe("in-flight")
  })

  it("setResponse with status<400 sets outcome.ok", () => {
    const s = useRequestHistoryStore.getState()
    const id = s.addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    s.setResponse(id, { status: 200, headers: { "content-type": "application/json" }, body: { ok: true }, durationMs: 42 })
    expect(useRequestHistoryStore.getState().entries[0]?.outcome.kind).toBe("ok")
  })

  it("setResponse with status>=400 sets outcome.error", () => {
    const s = useRequestHistoryStore.getState()
    const id = s.addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    s.setResponse(id, { status: 500, headers: {}, body: { error: "boom" }, durationMs: 5 })
    expect(useRequestHistoryStore.getState().entries[0]?.outcome.kind).toBe("error")
  })

  it("setError sets outcome.network-error", () => {
    const s = useRequestHistoryStore.getState()
    const id = s.addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    s.setError(id, "connection refused")
    const out = useRequestHistoryStore.getState().entries[0]?.outcome
    expect(out?.kind).toBe("network-error")
    if (out?.kind === "network-error") expect(out.message).toBe("connection refused")
  })

  it("caps at 20 entries; newest first", () => {
    const s = useRequestHistoryStore.getState()
    for (let i = 0; i < 22; i++) {
      s.addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: `/x/${i}` }, startedAt: 1000 + i })
    }
    const entries = useRequestHistoryStore.getState().entries
    expect(entries.length).toBe(20)
    expect(entries[0]?.request.path).toBe("/x/21")
  })

  it("clear empties the list", () => {
    const s = useRequestHistoryStore.getState()
    s.addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    s.clear()
    expect(useRequestHistoryStore.getState().entries).toEqual([])
  })
})
```

### Step 2: Verify FAIL

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test request-history -- --run 2>&1 | tail -15
```

### Step 3: Implement

```ts
// packages/ide/src/store/request-history.ts
import { create } from "zustand"
import type { RequestEnvelope } from "@darrylondil/lorien-runtime"

export interface RequestHistoryEntry {
  id: string
  workflowPath: string
  triggerNodeId: string
  request: RequestEnvelope
  startedAt: number
  outcome:
    | { kind: "in-flight" }
    | {
        kind: "ok"
        status: number
        headers: Record<string, string>
        body: unknown
        durationMs: number
      }
    | {
        kind: "error"
        status: number
        headers: Record<string, string>
        body: unknown
        durationMs: number
      }
    | { kind: "network-error"; message: string }
}

interface State {
  entries: RequestHistoryEntry[]
  addEntry: (e: Omit<RequestHistoryEntry, "id" | "outcome">) => string
  setResponse: (
    id: string,
    res: {
      status: number
      headers: Record<string, string>
      body: unknown
      durationMs: number
    },
  ) => void
  setError: (id: string, message: string) => void
  clear: () => void
}

let nextIdCounter = 0
const makeId = () => `h-${Date.now()}-${nextIdCounter++}`

export const useRequestHistoryStore = create<State>((set) => ({
  entries: [],
  addEntry: (e) => {
    const id = makeId()
    set((s) => ({
      entries: [{ ...e, id, outcome: { kind: "in-flight" } }, ...s.entries].slice(0, 20),
    }))
    return id
  },
  setResponse: (id, res) =>
    set((s) => ({
      entries: s.entries.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              outcome:
                res.status < 400
                  ? {
                      kind: "ok",
                      status: res.status,
                      headers: res.headers,
                      body: res.body,
                      durationMs: res.durationMs,
                    }
                  : {
                      kind: "error",
                      status: res.status,
                      headers: res.headers,
                      body: res.body,
                      durationMs: res.durationMs,
                    },
            }
          : entry,
      ),
    })),
  setError: (id, message) =>
    set((s) => ({
      entries: s.entries.map((entry) =>
        entry.id === id
          ? { ...entry, outcome: { kind: "network-error", message } }
          : entry,
      ),
    })),
  clear: () => set({ entries: [] }),
}))
```

### Step 4: Verify PASS + commit

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test request-history -- --run 2>&1 | tail -15
git add packages/ide/src/store/request-history.ts packages/ide/src/store/request-history.test.ts
git commit -m "feat(ide): request-history Zustand store

Client-side memory of IDE-fired HTTP requests with status indicator
(in-flight / ok / error / network-error). Cap 20, newest first.
status<400 → ok; status>=400 → error; fetch throw → network-error.

Used by the Run-tab history table; populated by the SendButton when
it issues fetch calls in Task 9.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: SendButton → fetch + history wiring

**Files:**
- Modify: `packages/ide/src/panels/run-tab/request-builder.tsx`

### Step 1: Rewrite the SendButton

Open `packages/ide/src/panels/run-tab/request-builder.tsx`. The existing SendButton uses `recordFire` + WS `fire`. Replace it with the fetch-based version:

```tsx
import { useState } from "react"
import type { RequestEnvelope } from "@darrylondil/lorien-runtime"
import { useDebugSessionStore } from "@/store/debug-session"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useTabsStore } from "@/store/tabs"
import { useRequestHistoryStore } from "@/store/request-history"
import { restBase } from "@/lib/api"
import { BodyTypeTabs } from "./body-type-tabs"
import { BodyEditor } from "./body-editor"
import { KeyValueGrid } from "./key-value-grid"
import { serializeBody } from "./serialize-body"

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

export function RequestBuilder() {
  // ... unchanged top-of-component code: pulls form, hides when no triggerNodeId ...
  // ... unchanged JSX for method/path/body/headers/query ...
}

function SendButton() {
  const form = useDebugSessionStore((s) => s.requestForm)
  const liveTabId = useLiveWorkflowStore((s) => s.tabId)
  const tabs = useTabsStore((s) => s.tabs)
  const workflowPath = tabs.find((t) => t.id === liveTabId)?.path ?? ""
  const addEntry = useRequestHistoryStore((s) => s.addEntry)
  const setResponse = useRequestHistoryStore((s) => s.setResponse)
  const setError = useRequestHistoryStore((s) => s.setError)
  const [bodyError, setBodyError] = useState<string | null>(null)

  const onClick = async () => {
    if (!form.triggerNodeId || !workflowPath) return
    const r = serializeBody(form)
    if (r.error !== undefined) {
      setBodyError(r.error)
      return
    }
    setBodyError(null)

    const envelope: RequestEnvelope = {
      method: form.method,
      path: form.path,
      ...(r.body !== undefined ? { body: r.body } : {}),
      ...(form.query.length > 0
        ? { query: Object.fromEntries(form.query.filter(([k]) => k.length > 0)) }
        : {}),
      ...(form.headers.length > 0
        ? { headers: Object.fromEntries(form.headers.filter(([k]) => k.length > 0)) }
        : {}),
    }

    const url = new URL(`${restBase()}${form.path}`)
    for (const [k, v] of form.query) {
      if (k.length > 0) url.searchParams.set(k, v)
    }
    const headers: Record<string, string> = {}
    for (const [k, v] of form.headers) {
      if (k.length > 0) headers[k] = v
    }
    let bodyInit: BodyInit | undefined
    if (r.body !== undefined) {
      bodyInit =
        typeof r.body === "string" ? r.body : JSON.stringify(r.body)
      if (
        typeof r.body !== "string" &&
        !Object.keys(headers).some(
          (k) => k.toLowerCase() === "content-type",
        )
      ) {
        headers["Content-Type"] = "application/json"
      }
    }

    const id = addEntry({
      workflowPath,
      triggerNodeId: form.triggerNodeId,
      request: envelope,
      startedAt: Date.now(),
    })

    try {
      const startedAt = Date.now()
      const res = await fetch(url.toString(), {
        method: form.method,
        headers,
        body: bodyInit,
      })
      const responseHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => {
        responseHeaders[k] = v
      })
      const text = await res.text()
      let body: unknown = text
      const ct = res.headers.get("content-type") ?? ""
      if (ct.includes("application/json")) {
        try {
          body = JSON.parse(text)
        } catch {
          /* keep text */
        }
      }
      setResponse(id, {
        status: res.status,
        headers: responseHeaders,
        body,
        durationMs: Date.now() - startedAt,
      })
    } catch (e) {
      setError(id, (e as Error).message)
    }
  }

  // Send is disabled only when no trigger is picked (no more "in-flight" gate;
  // multiple concurrent requests are now supported)
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={!form.triggerNodeId}
        className="rounded-md border bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        onClick={() => void onClick()}
      >
        Send
      </button>
      {bodyError && <span className="text-red-700">{bodyError}</span>}
    </div>
  )
}
```

Notes:
- The `inFlight` state check is removed because multiple concurrent requests are supported now.
- `recordFire` calls are gone (removed from the store in Task 7).
- The transport's `send(fire)` is gone — IDE no longer sends WS fire.

### Step 2: Verify build + test

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test 2>&1 | tail -15
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

The existing send-button test from the body-picker plan may need updates. If a test asserts on `recordFire` being called or on WS messages being sent, replace those assertions with `useRequestHistoryStore.getState().entries[0]` checks.

If `vi.spyOn(global, "fetch")` is needed for tests, that's the right pattern. Mock fetch to return controlled responses.

### Step 3: Commit

```bash
git add packages/ide/src/panels/run-tab/request-builder.tsx
git commit -m "feat(ide): SendButton fires real HTTP via fetch; adds history entry

restBase() + form.path determines the URL. JSON body is stringified
and Content-Type is auto-set to application/json when missing.
Non-JSON bodies (xml/text/form) are sent as raw strings.

The request-history store records each send with in-flight status,
then ok/error/network-error on resolve. Multiple concurrent requests
are supported (no in-flight gate on the Send button).

The WS `fire`/`replay` messages are no longer constructed by the IDE.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10: HistoryTable component + Run-tab integration

**Files:**
- Create: `packages/ide/src/panels/run-tab/history-table.tsx`
- Create: `packages/ide/src/panels/run-tab/history-table.test.tsx`
- Modify: `packages/ide/src/panels/run-tab/index.tsx`

### Step 1: Write failing tests

```tsx
// packages/ide/src/panels/run-tab/history-table.test.tsx
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useRequestHistoryStore } from "@/store/request-history"
import { HistoryTable } from "./history-table"

describe("HistoryTable", () => {
  afterEach(() => {
    cleanup()
    useRequestHistoryStore.setState({ entries: [] })
  })

  it("renders empty state when there are no entries", () => {
    render(<HistoryTable />)
    expect(screen.getByText(/no requests yet/i)).toBeInTheDocument()
  })

  it("renders one row per entry", () => {
    useRequestHistoryStore.getState().addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "POST", path: "/a" }, startedAt: 1000 })
    useRequestHistoryStore.getState().addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/b" }, startedAt: 1001 })
    render(<HistoryTable />)
    expect(screen.getAllByTestId("history-row")).toHaveLength(2)
  })

  it("shows spinner for in-flight entries", () => {
    useRequestHistoryStore.getState().addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    render(<HistoryTable />)
    expect(screen.getByTestId("status-in-flight")).toBeInTheDocument()
  })

  it("shows green dot for status<400", () => {
    const id = useRequestHistoryStore.getState().addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    useRequestHistoryStore.getState().setResponse(id, { status: 200, headers: {}, body: null, durationMs: 1 })
    render(<HistoryTable />)
    expect(screen.getByTestId("status-ok")).toBeInTheDocument()
  })

  it("shows red dot for status>=400", () => {
    const id = useRequestHistoryStore.getState().addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    useRequestHistoryStore.getState().setResponse(id, { status: 500, headers: {}, body: { error: "boom" }, durationMs: 1 })
    render(<HistoryTable />)
    expect(screen.getByTestId("status-error")).toBeInTheDocument()
  })

  it("shows gray dot for network error", () => {
    const id = useRequestHistoryStore.getState().addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    useRequestHistoryStore.getState().setError(id, "refused")
    render(<HistoryTable />)
    expect(screen.getByTestId("status-network-error")).toBeInTheDocument()
  })

  it("expands a row on click to show response details", () => {
    const id = useRequestHistoryStore.getState().addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    useRequestHistoryStore.getState().setResponse(id, { status: 200, headers: { "content-type": "application/json" }, body: { ok: true }, durationMs: 7 })
    render(<HistoryTable />)
    expect(screen.queryByTestId("response-details")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId("history-row"))
    expect(screen.getByTestId("response-details")).toBeInTheDocument()
  })
})
```

### Step 2: Verify FAIL

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test history-table -- --run 2>&1 | tail -15
```

### Step 3: Implement

```tsx
// packages/ide/src/panels/run-tab/history-table.tsx
import { useState } from "react"
import {
  useRequestHistoryStore,
  type RequestHistoryEntry,
} from "@/store/request-history"

export function HistoryTable() {
  const entries = useRequestHistoryStore((s) => s.entries)

  if (entries.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        No requests yet. Send a request to populate the history.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        History
      </div>
      {entries.map((e) => (
        <HistoryRow key={e.id} entry={e} />
      ))}
    </div>
  )
}

function HistoryRow({ entry }: { entry: RequestHistoryEntry }) {
  const [open, setOpen] = useState(false)
  const startedAt = new Date(entry.startedAt).toLocaleTimeString()
  return (
    <div className="rounded-md border bg-background">
      <button
        type="button"
        data-testid="history-row"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent/30"
      >
        <StatusIndicator outcome={entry.outcome} />
        <span className="w-16 text-muted-foreground">{startedAt}</span>
        <span className="w-12 font-mono">{entry.request.method}</span>
        <span className="flex-1 truncate font-mono">{entry.request.path}</span>
        {entry.outcome.kind === "ok" || entry.outcome.kind === "error" ? (
          <span className="text-muted-foreground">
            {entry.outcome.status} ({entry.outcome.durationMs}ms)
          </span>
        ) : null}
      </button>
      {open && (
        <div data-testid="response-details" className="border-t bg-muted/10 p-2">
          {entry.outcome.kind === "in-flight" && (
            <div className="text-muted-foreground">In flight…</div>
          )}
          {entry.outcome.kind === "network-error" && (
            <div className="text-red-700">Network error: {entry.outcome.message}</div>
          )}
          {(entry.outcome.kind === "ok" || entry.outcome.kind === "error") && (
            <ResponseView outcome={entry.outcome} />
          )}
        </div>
      )}
    </div>
  )
}

function StatusIndicator({ outcome }: { outcome: RequestHistoryEntry["outcome"] }) {
  if (outcome.kind === "in-flight")
    return (
      <span data-testid="status-in-flight" className="inline-block h-2 w-2 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
    )
  if (outcome.kind === "ok")
    return <span data-testid="status-ok" className="inline-block h-2 w-2 rounded-full bg-green-500" />
  if (outcome.kind === "error")
    return <span data-testid="status-error" className="inline-block h-2 w-2 rounded-full bg-red-500" />
  return <span data-testid="status-network-error" className="inline-block h-2 w-2 rounded-full bg-gray-400" />
}

function ResponseView({
  outcome,
}: {
  outcome: Extract<RequestHistoryEntry["outcome"], { kind: "ok" | "error" }>
}) {
  const bodyText =
    typeof outcome.body === "string"
      ? outcome.body
      : JSON.stringify(outcome.body, null, 2)
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Response headers
        </div>
        <pre className="max-h-24 overflow-auto rounded-md bg-muted/40 p-2 text-[10px]">
          {Object.entries(outcome.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")}
        </pre>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Response body
        </div>
        <pre className="max-h-48 overflow-auto rounded-md bg-muted/40 p-2 text-[10px]">
          {bodyText}
        </pre>
      </div>
    </div>
  )
}
```

### Step 4: Integrate into Run tab

Modify `packages/ide/src/panels/run-tab/index.tsx`. Remove the Timeline, RunPicker, and StatusBanner imports + JSX (they move to the Debug panel in Tasks 12-13). Add HistoryTable:

```tsx
import { useDebugTransport } from "@/hooks/use-debug-transport"
import { useDebugSessionStore } from "@/store/debug-session"
import { TriggerSelector } from "./trigger-selector"
import { RequestBuilder } from "./request-builder"
import { HistoryTable } from "./history-table"

export function RunTab() {
  useDebugTransport()
  const connected = useDebugSessionStore((s) => s.connected)
  return (
    <div className="flex h-full flex-col gap-3" data-testid="run-tab">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Send
        </div>
        <div className="text-[10px]">
          <span className={connected ? "text-green-600" : "text-muted-foreground"}>
            {connected ? "● debug connected" : "○ debug disconnected"}
          </span>
        </div>
      </div>
      <TriggerSelector />
      <RequestBuilder />
      <div className="h-px bg-border" />
      <HistoryTable />
    </div>
  )
}
```

The old `run-picker.tsx` is deleted in a later step (Task 12).

### Step 5: Verify + commit

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test 2>&1 | tail -15
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: green.

```bash
git add packages/ide/src/panels/run-tab/history-table.tsx packages/ide/src/panels/run-tab/history-table.test.tsx packages/ide/src/panels/run-tab/index.tsx
git commit -m "feat(ide): Run-tab HistoryTable + integration

Postman-style request history below the form: client-side memory,
status indicator (spinner / green / red / gray dot), click row to
expand response headers + pretty-printed body. Cap 20 entries.

The Run tab no longer renders Timeline/RunPicker/StatusBanner —
those move to the new Debug panel in subsequent tasks.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 11: TriggerSelector — shadcn Select + always-visible

**Files:**
- Create: `packages/ide/src/components/ui/select.tsx` (via shadcn CLI)
- Modify: `packages/ide/src/panels/run-tab/trigger-selector.tsx`
- Modify: `packages/ide/src/panels/run-tab/trigger-selector.test.tsx`

### Step 1: Add the shadcn Select component

```bash
cd C:/Users/hello/source/cozy-api/packages/ide && pnpm dlx shadcn@latest add select
```

This creates `packages/ide/src/components/ui/select.tsx`. Inspect it; it should export `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` (radix-based).

### Step 2: Update tests for always-visible behavior

In `packages/ide/src/panels/run-tab/trigger-selector.test.tsx`, the existing tests assert that 1-trigger renders nothing. Update them to assert the picker DOES render in the 1-trigger case. Add a new test for the visual presence:

```tsx
it("renders the picker even when there's only one trigger", () => {
  setWorkflow({
    lorien: 1,
    nodes: {
      req: { uses: "@core/http-request", values: { method: "POST", path: "/u" } },
    },
  } as unknown as WorkflowFile)
  const { container } = render(<TriggerSelector />)
  // shadcn Select renders a button trigger with role "combobox" or aria-haspopup
  expect(container.querySelector('[role="combobox"]')).toBeTruthy()
})
```

Any existing test that did `triggers.length === 1 → returns null` needs to be updated.

### Step 3: Rewrite `trigger-selector.tsx`

```tsx
import { useEffect } from "react"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useDebugSessionStore } from "@/store/debug-session"
import type { WorkflowFile } from "@/lib/api"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface Trigger {
  nodeId: string
  method: string
  path: string
}

function discoverTriggers(workflow: WorkflowFile | null): Trigger[] {
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

function defaultBodyKindForMethod(method: string): "json" | "none" {
  const upper = method.toUpperCase()
  return upper === "POST" || upper === "PUT" || upper === "PATCH"
    ? "json"
    : "none"
}

function pickTrigger(t: Trigger) {
  const bodyKind = defaultBodyKindForMethod(t.method)
  const headers: Array<[string, string]> =
    bodyKind === "none" ? [] : [["Content-Type", "application/json"]]
  useDebugSessionStore.getState().setRequestForm(() => ({
    triggerNodeId: t.nodeId,
    method: t.method,
    path: t.path,
    bodyKind,
    body: "",
    formBody: [],
    query: [],
    headers,
  }))
}

export function TriggerSelector() {
  const workflow = useLiveWorkflowStore((s) => s.workflow)
  const selected = useDebugSessionStore((s) => s.requestForm.triggerNodeId)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)
  const triggers = discoverTriggers(workflow)

  useEffect(() => {
    if (triggers.length === 0 && selected !== null) {
      setRequestForm(() => ({
        triggerNodeId: null,
        method: "GET",
        path: "/",
        bodyKind: "none",
        body: "",
        formBody: [],
        query: [],
        headers: [],
      }))
      return
    }
    if (triggers.length >= 1 && (selected === null || !triggers.find((t) => t.nodeId === selected))) {
      pickTrigger(triggers[0]!)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggers.length, triggers.map((t) => t.nodeId).join("|")])

  if (triggers.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        Add an <code>@core/http-request</code> node to debug this workflow.
      </div>
    )
  }

  const current = triggers.find((t) => t.nodeId === selected) ?? triggers[0]!

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Trigger:</span>
      <Select
        value={current.nodeId}
        onValueChange={(id) => {
          const t = triggers.find((tr) => tr.nodeId === id)
          if (t) pickTrigger(t)
        }}
      >
        <SelectTrigger className="h-7 min-w-[180px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {triggers.map((t) => (
            <SelectItem key={t.nodeId} value={t.nodeId}>
              <span className="font-mono">{t.method}</span> {t.path}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
```

### Step 4: Verify + commit

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test trigger-selector -- --run 2>&1 | tail -20
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: green.

```bash
git add packages/ide/src/panels/run-tab/trigger-selector.tsx packages/ide/src/panels/run-tab/trigger-selector.test.tsx packages/ide/src/components/ui/select.tsx packages/ide/package.json packages/ide/pnpm-lock.yaml 2>/dev/null
# pnpm-lock at workspace root may also need staging:
git add pnpm-lock.yaml
git commit -m "feat(ide): TriggerSelector — shadcn Select, always-visible

Replaces the bare <select> with shadcn's <Select> (radix-based) for
consistent styling. The picker is always rendered when at least one
trigger exists (previously hidden in the single-trigger case), so
users always see which trigger they're targeting.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 12: Debug panel shell + RunsList + layout integration

**Files:**
- Create: `packages/ide/src/panels/debug-panel/index.tsx`
- Create: `packages/ide/src/panels/debug-panel/runs-list.tsx`
- Create: `packages/ide/src/panels/debug-panel/runs-list.test.tsx`
- Modify: `packages/ide/src/layout/default-layout.ts`
- Modify: `packages/ide/src/layout/dock-view.tsx` (or app.tsx — wherever components are registered)
- Delete: `packages/ide/src/panels/run-tab/run-picker.tsx` (and its test)

### Step 1: Write failing tests for RunsList

```tsx
// packages/ide/src/panels/debug-panel/runs-list.test.tsx
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useDebugSessionStore } from "@/store/debug-session"
import type { ServerMessage } from "@darrylondil/lorien-runtime"
import { RunsList } from "./runs-list"

describe("RunsList", () => {
  afterEach(() => {
    cleanup()
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState())
  })

  it("renders empty state when no runs", () => {
    render(<RunsList />)
    expect(screen.getByText(/no runs/i)).toBeInTheDocument()
  })

  it("renders one row per run", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "event", runId: "rB", event: { type: "before-node", nodeId: "y", input: {} }, offsetMs: 0 } as ServerMessage)
    render(<RunsList />)
    expect(screen.getAllByTestId("runs-row")).toHaveLength(2)
  })

  it("clicking a row changes selectedRunId", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "event", runId: "rB", event: { type: "before-node", nodeId: "y", input: {} }, offsetMs: 0 } as ServerMessage)
    render(<RunsList />)
    const rows = screen.getAllByTestId("runs-row")
    fireEvent.click(rows[1]!)
    // The second row visually corresponds to the older run; assert selectedRunId changed
    const state = useDebugSessionStore.getState()
    expect(state.selectedRunId).not.toBe(state.runs[0]?.runId)
  })
})
```

### Step 2: Implement RunsList

```tsx
// packages/ide/src/panels/debug-panel/runs-list.tsx
import { useDebugSessionStore, type RunRecord } from "@/store/debug-session"
import { cn } from "@/lib/utils"

export function RunsList() {
  const runs = useDebugSessionStore((s) => s.runs)
  const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)
  const selectRun = useDebugSessionStore((s) => s.selectRun)

  if (runs.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        No runs yet. Fire a request from the Send tab or hit the dev server
        from curl / Postman.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      {runs.map((r) => (
        <button
          key={r.runId}
          type="button"
          data-testid="runs-row"
          onClick={() => selectRun(r.runId)}
          className={cn(
            "flex items-center gap-2 rounded-md border px-2 py-1 text-left hover:bg-accent/30",
            selectedRunId === r.runId && "bg-accent/40 ring-1 ring-primary",
          )}
        >
          <StatusBadge run={r} />
          <span className="w-16 text-muted-foreground">
            {new Date(r.startedAt).toLocaleTimeString()}
          </span>
          <span className="w-12 font-mono">{r.request.method}</span>
          <span className="flex-1 truncate font-mono">{r.request.path}</span>
        </button>
      ))}
    </div>
  )
}

function StatusBadge({ run }: { run: RunRecord }) {
  const out = run.outcome
  if (out.kind === "running")
    return <span className="text-blue-500">▶</span>
  if (out.kind === "paused" && run.pausedFrame)
    return <span className="text-yellow-600 font-mono text-[10px]">⏸ {run.pausedFrame.nodeId}</span>
  if (out.kind === "ok")
    return <span className="text-green-600 font-mono text-[10px]">✓ {out.status}</span>
  if (out.kind === "errored")
    return <span className="text-red-600 font-mono text-[10px]">✕</span>
  return null
}
```

### Step 3: Implement DebugPanel shell

```tsx
// packages/ide/src/panels/debug-panel/index.tsx
import { useDebugTransport } from "@/hooks/use-debug-transport"
import { RunsList } from "./runs-list"

export function DebugPanel() {
  useDebugTransport()
  return (
    <div className="flex h-full flex-col gap-3 p-3" data-testid="debug-panel">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Debug
      </div>
      <RunsList />
      {/* SelectedRunView (Task 13) renders below this */}
    </div>
  )
}
```

### Step 4: Add the layout integration

In `packages/ide/src/layout/default-layout.ts`, add `"debug"` to `PaneId`, `PANE_IDS`, `PANE_TITLES`. In `buildDefaultLayout`:

```ts
api.addPanel({
  id: "debug",
  component: "debug",
  title: "Debug",
  position: { referencePanel: "inspector", direction: "within" },
})
```

In `reopenPanel`, add a branch:

```ts
} else if (id === "debug") {
  const ref = api.getPanel("inspector") ?? api.getPanel("code") ?? api.getPanel("workflow")
  if (ref) options.position = { referencePanel: ref.id, direction: "within" }
  options.initialWidth = 400
}
```

In `packages/ide/src/layout/dock-view.tsx`, register the new component (find where `files`, `workflow`, `code`, `inspector` are registered and add):

```ts
import { DebugPanel } from "@/panels/debug-panel"

// In the components map / registry:
debug: () => <DebugPanel />,
```

### Step 5: Delete the old RunPicker

```bash
rm packages/ide/src/panels/run-tab/run-picker.tsx
# also delete the test if one exists:
rm -f packages/ide/src/panels/run-tab/run-picker.test.tsx
```

### Step 6: Verify + commit

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test 2>&1 | tail -15
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: green.

```bash
git add packages/ide/src/panels/debug-panel/ packages/ide/src/layout/default-layout.ts packages/ide/src/layout/dock-view.tsx
git rm -f packages/ide/src/panels/run-tab/run-picker.tsx packages/ide/src/panels/run-tab/run-picker.test.tsx 2>/dev/null
git commit -m "feat(ide): new Debug dock panel + RunsList; remove RunPicker

Top-level Debug pane (tabbed with Inspector by default) shows all
server-side runs. RunsList renders one row per run with a status
badge (running / paused at node / 2xx / err); click a row to
selectRun. Tasks 13-14 add the selected-run view, timeline + logs,
and step controls.

The Run-tab run-picker is gone — its role is subsumed by the
Debug panel.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 13: SelectedRunView + move Timeline + StatusBanner

**Files:**
- Create: `packages/ide/src/panels/debug-panel/selected-run-view.tsx`
- Create: `packages/ide/src/panels/debug-panel/selected-run-view.test.tsx`
- Move: `packages/ide/src/panels/run-tab/timeline.tsx` → `packages/ide/src/panels/debug-panel/timeline.tsx` (with prop changes)
- Move: `packages/ide/src/panels/run-tab/status-banner.tsx` → `packages/ide/src/panels/debug-panel/status-banner.tsx` (with prop changes)
- Modify: `packages/ide/src/panels/debug-panel/index.tsx` to render SelectedRunView

### Step 1: Move `status-banner.tsx`

The existing status-banner takes a `send` prop. Rewrite to take `runId: string | null` and use store actions internally:

```tsx
// packages/ide/src/panels/debug-panel/status-banner.tsx
import { useDebugSessionStore } from "@/store/debug-session"

export function StatusBanner({ runId }: { runId: string | null }) {
  const run = useDebugSessionStore((s) =>
    runId ? s.runs.find((r) => r.runId === runId) ?? null : null,
  )
  const sendContinue = useDebugSessionStore((s) => s.sendContinue)
  const sendStep = useDebugSessionStore((s) => s.sendStep)
  const sendStepOver = useDebugSessionStore((s) => s.sendStepOver)
  const sendStop = useDebugSessionStore((s) => s.sendStop)

  if (!run) return null
  const out = run.outcome
  if (out.kind === "running") {
    return (
      <BannerShell label="▶ Running…">
        <ControlButton variant="danger" onClick={() => sendStop(run.runId)}>Stop</ControlButton>
      </BannerShell>
    )
  }
  if (out.kind === "paused" && run.pausedFrame) {
    return (
      <BannerShell label={`⏸ Paused at ${run.pausedFrame.nodeId}.${run.pausedFrame.phase}`}>
        <ControlButton onClick={() => sendContinue(run.runId)}>Continue</ControlButton>
        <ControlButton onClick={() => sendStep(run.runId)}>Step</ControlButton>
        {run.pausedFrame.phase === "before" && (
          <ControlButton onClick={() => sendStepOver(run.runId)}>Step Over</ControlButton>
        )}
        <ControlButton variant="danger" onClick={() => sendStop(run.runId)}>Stop</ControlButton>
      </BannerShell>
    )
  }
  if (out.kind === "ok") {
    return <BannerShell label={`✓ Completed (${out.status}, ${out.totalMs}ms)`} />
  }
  if (out.kind === "errored") {
    return <BannerShell label={`✕ Errored: ${out.message}`} variant="error" />
  }
  return null
}

function BannerShell({
  label,
  children,
  variant,
}: {
  label: string
  children?: React.ReactNode
  variant?: "error"
}) {
  return (
    <div
      className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs"
      data-testid="status-banner"
    >
      <div className={variant === "error" ? "text-red-700" : ""}>{label}</div>
      {children && <div className="flex gap-1">{children}</div>}
    </div>
  )
}

function ControlButton({
  onClick,
  children,
  variant,
}: {
  onClick: () => void
  children: React.ReactNode
  variant?: "danger"
}) {
  return (
    <button
      type="button"
      className={
        variant === "danger"
          ? "rounded-md border bg-background px-2 py-1 text-red-700 hover:bg-accent"
          : "rounded-md border bg-background px-2 py-1 hover:bg-accent"
      }
      onClick={onClick}
    >
      {children}
    </button>
  )
}
```

Delete the old `packages/ide/src/panels/run-tab/status-banner.tsx`.

### Step 2: Move `timeline.tsx`

The existing timeline.tsx renders based on `selectedRunId` from the store. The move is mostly a relocation. Update it to accept a `runId` prop for clarity:

```tsx
// packages/ide/src/panels/debug-panel/timeline.tsx
import { useState } from "react"
import { useDebugSessionStore, type RunRecord } from "@/store/debug-session"

export function Timeline({ runId }: { runId: string | null }) {
  const run = useDebugSessionStore((s) =>
    runId ? s.runs.find((r) => r.runId === runId) ?? null : null,
  )
  if (!run) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        No run selected.
      </div>
    )
  }
  // ... rest is the existing implementation from packages/ide/src/panels/run-tab/timeline.tsx,
  // minus the `runs.find(...)` lookup that derived `run` from selectedRunId.
}
```

Read the existing `packages/ide/src/panels/run-tab/timeline.tsx` and migrate its `foldEdges`, `TimelineRow`, and outer rendering. Delete the original.

### Step 3: Implement SelectedRunView

```tsx
// packages/ide/src/panels/debug-panel/selected-run-view.tsx
import { useState } from "react"
import { useDebugSessionStore } from "@/store/debug-session"
import { cn } from "@/lib/utils"
import { StatusBanner } from "./status-banner"
import { Timeline } from "./timeline"

// LogsView is implemented in Task 14; import as a placeholder for now and Task 14 fills it in
import { LogsView } from "./logs-view"

export function SelectedRunView() {
  const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)
  const [tab, setTab] = useState<"timeline" | "logs">("timeline")

  if (!selectedRunId) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        Select a run from the list to see details.
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-hidden">
      <StatusBanner runId={selectedRunId} />
      <div className="flex gap-1 border-b text-xs">
        <TabButton active={tab === "timeline"} onClick={() => setTab("timeline")}>Timeline</TabButton>
        <TabButton active={tab === "logs"} onClick={() => setTab("logs")}>Logs</TabButton>
      </div>
      <div className="flex-1 overflow-auto">
        {tab === "timeline" ? (
          <Timeline runId={selectedRunId} />
        ) : (
          <LogsView runId={selectedRunId} />
        )}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1 -mb-px border-b-2 border-transparent",
        active && "border-primary text-foreground",
      )}
    >
      {children}
    </button>
  )
}
```

Note: `LogsView` is implemented in Task 14. For this task, create a placeholder so the import doesn't break:

```tsx
// packages/ide/src/panels/debug-panel/logs-view.tsx
export function LogsView({ runId: _runId }: { runId: string | null }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
      Logs view — implemented in Task 14.
    </div>
  )
}
```

### Step 4: Update DebugPanel to render SelectedRunView

```tsx
// packages/ide/src/panels/debug-panel/index.tsx
import { useDebugTransport } from "@/hooks/use-debug-transport"
import { RunsList } from "./runs-list"
import { SelectedRunView } from "./selected-run-view"

export function DebugPanel() {
  useDebugTransport()
  return (
    <div className="flex h-full flex-col gap-3 p-3" data-testid="debug-panel">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Debug
      </div>
      <RunsList />
      <SelectedRunView />
    </div>
  )
}
```

### Step 5: Write SelectedRunView tests

```tsx
// packages/ide/src/panels/debug-panel/selected-run-view.test.tsx
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useDebugSessionStore } from "@/store/debug-session"
import type { ServerMessage } from "@darrylondil/lorien-runtime"
import { SelectedRunView } from "./selected-run-view"

describe("SelectedRunView", () => {
  afterEach(() => {
    cleanup()
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState())
  })

  it("renders empty state when no run is selected", () => {
    render(<SelectedRunView />)
    expect(screen.getByText(/select a run/i)).toBeInTheDocument()
  })

  it("renders Timeline + Logs tabs when a run is selected", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.selectRun("rA")
    render(<SelectedRunView />)
    expect(screen.getByText("Timeline")).toBeInTheDocument()
    expect(screen.getByText("Logs")).toBeInTheDocument()
  })

  it("tab buttons toggle which view shows", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.selectRun("rA")
    render(<SelectedRunView />)
    fireEvent.click(screen.getByText("Logs"))
    expect(screen.getByText(/Logs view/i)).toBeInTheDocument() // placeholder text from Task 13
  })
})
```

### Step 6: Verify + commit

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test 2>&1 | tail -15
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

```bash
git add packages/ide/src/panels/debug-panel/ packages/ide/src/panels/run-tab/
git commit -m "feat(ide): Debug panel SelectedRunView + move Timeline + StatusBanner

Timeline and StatusBanner move from run-tab/ to debug-panel/ and
accept an explicit runId prop instead of reading selectedRunId
directly. StatusBanner's step controls call store actions
(sendContinue/sendStep/sendStepOver/sendStop) with the run's runId.

SelectedRunView is a two-tab container (Timeline | Logs) shown below
the runs list. The LogsView is a placeholder; Task 14 fills it in.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 14: LogsView + canvas integration update

**Files:**
- Modify: `packages/ide/src/panels/debug-panel/logs-view.tsx` (replace placeholder)
- Create: `packages/ide/src/panels/debug-panel/logs-view.test.tsx`
- Modify: `packages/ide/src/workflow/workflow-editor.tsx`

### Step 1: Write failing LogsView tests

```tsx
// packages/ide/src/panels/debug-panel/logs-view.test.tsx
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useDebugSessionStore } from "@/store/debug-session"
import type { ServerMessage } from "@darrylondil/lorien-runtime"
import { LogsView } from "./logs-view"

describe("LogsView", () => {
  afterEach(() => {
    cleanup()
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState())
  })

  it("renders empty state for a run with no logs", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    render(<LogsView runId="rA" />)
    expect(screen.getByText(/no logs/i)).toBeInTheDocument()
  })

  it("renders one row per log entry", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "log", runId: "rA", level: "info", message: "hello", offsetMs: 5 } as ServerMessage)
    s.applyMessage({ type: "log", runId: "rA", level: "warn", message: "be careful", offsetMs: 10 } as ServerMessage)
    render(<LogsView runId="rA" />)
    expect(screen.getAllByTestId("log-row")).toHaveLength(2)
  })

  it("filter input narrows by message substring", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "log", runId: "rA", level: "info", message: "alpha", offsetMs: 5 } as ServerMessage)
    s.applyMessage({ type: "log", runId: "rA", level: "info", message: "beta", offsetMs: 6 } as ServerMessage)
    render(<LogsView runId="rA" />)
    fireEvent.change(screen.getByPlaceholderText(/filter/i), { target: { value: "alph" } })
    expect(screen.getAllByTestId("log-row")).toHaveLength(1)
  })

  it("surfaces error events with their stack", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({
      type: "event",
      runId: "rA",
      event: { type: "error", nodeId: "x", error: { message: "boom", stack: "Error: boom\n  at x" } },
      offsetMs: 5,
    } as ServerMessage)
    render(<LogsView runId="rA" />)
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })
})
```

### Step 2: Implement LogsView

```tsx
// packages/ide/src/panels/debug-panel/logs-view.tsx
import { useState } from "react"
import { useDebugSessionStore, type LogEntry } from "@/store/debug-session"

interface DisplayRow {
  offsetMs: number
  level: "log" | "info" | "warn" | "error"
  message: string
  stack?: string
}

export function LogsView({ runId }: { runId: string | null }) {
  const run = useDebugSessionStore((s) =>
    runId ? s.runs.find((r) => r.runId === runId) ?? null : null,
  )
  const [filter, setFilter] = useState("")

  if (!run) return null

  const rows: DisplayRow[] = []
  for (const log of run.logs) rows.push({ offsetMs: log.offsetMs, level: log.level, message: log.message })
  // Surface error events too
  for (const e of run.events) {
    if (e.event.type === "error") {
      rows.push({
        offsetMs: e.offsetMs,
        level: "error",
        message: `[${e.event.nodeId}] ${e.event.error.message}`,
        ...(e.event.error.stack ? { stack: e.event.error.stack } : {}),
      })
    }
  }
  // run-error outcome stack (already surfaces in StatusBanner; show in logs too if errored)
  if (run.outcome.kind === "errored" && run.outcome.stack) {
    rows.push({
      offsetMs: run.outcome.totalMs ?? 0,
      level: "error",
      message: run.outcome.message,
      stack: run.outcome.stack,
    })
  }

  rows.sort((a, b) => a.offsetMs - b.offsetMs)

  const filtered = filter
    ? rows.filter((r) => r.message.toLowerCase().includes(filter.toLowerCase()))
    : rows

  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        No logs for this run yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      <input
        type="text"
        placeholder="Filter logs…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="rounded-md border bg-background px-2 py-1 font-mono"
      />
      <div className="flex flex-col gap-1 font-mono text-[11px]">
        {filtered.map((row, i) => (
          <LogRow key={i} row={row} />
        ))}
      </div>
    </div>
  )
}

function LogRow({ row }: { row: DisplayRow }) {
  const [open, setOpen] = useState(false)
  const tone =
    row.level === "error"
      ? "text-red-700"
      : row.level === "warn"
        ? "text-yellow-700"
        : row.level === "info"
          ? "text-blue-700"
          : "text-foreground"
  return (
    <div data-testid="log-row">
      <button
        type="button"
        onClick={() => row.stack && setOpen((v) => !v)}
        className="flex w-full items-start gap-2 text-left hover:bg-accent/30"
      >
        <span className="w-12 text-muted-foreground">+{row.offsetMs}ms</span>
        <span className={`w-12 uppercase ${tone}`}>{row.level}</span>
        <span className="flex-1 whitespace-pre-wrap">{row.message}</span>
      </button>
      {open && row.stack && (
        <pre className="ml-24 max-h-48 overflow-auto rounded-md bg-muted/40 p-2 text-[10px]">
          {row.stack}
        </pre>
      )}
    </div>
  )
}
```

### Step 3: Update workflow-editor.tsx canvas integration

Read `packages/ide/src/workflow/workflow-editor.tsx`. Find the `useDebugSessionStore` subscriptions that drive `nodeStatuses` and the edge-flash effect (both added in earlier debugger tasks). Replace them:

```ts
// OLD (around the existing nodeStatuses effect):
// const nodeStatuses = useDebugSessionStore((s) => s.nodeStatuses)
// ↓
const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)
const nodeStatuses = useDebugSessionStore((s) =>
  selectedRunId ? s.nodeStatusesFor(selectedRunId) : new Map(),
)
```

For the edge-flash effect:
```ts
// OLD:
// const runs = useDebugSessionStore((s) => s.runs)
// const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)
// const currentRun = runs.find((r) => r.runId === selectedRunId) ?? runs[0]
// ↓
const selectedRun = useDebugSessionStore((s) => s.selectedRun())
const currentRun = selectedRun
// rest of the edge-flash effect logic uses currentRun.events
```

The breakpoints + breakpoint-dots subscription is independent of run selection — leave it alone.

### Step 4: Verify everything + run full project gate

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test 2>&1 | tail -15
cd C:/Users/hello/source/cozy-api && pnpm -r typecheck 2>&1 | tail -15
cd C:/Users/hello/source/cozy-api && pnpm -r build 2>&1 | tail -15
cd C:/Users/hello/source/cozy-api && pnpm -r test 2>&1 | tail -25
```

Expected: all green across runtime, ide, build, openapi, examples.

### Step 5: Commit

```bash
git add packages/ide/src/panels/debug-panel/logs-view.tsx packages/ide/src/panels/debug-panel/logs-view.test.tsx packages/ide/src/workflow/workflow-editor.tsx
git commit -m "feat(ide): LogsView with filter + canvas reads from selected run

LogsView merges per-run log entries with error events (and the
run-error outcome's stack). Filter input narrows by substring. Error
rows with a stack are click-to-expand.

workflow-editor.tsx now derives nodeStatuses from the SELECTED run's
events via nodeStatusesFor(selectedRunId), so switching focused runs
updates the canvas borders. Edge-fired flash subscribes to the
selected run's events.

Completes the debugger HTTP refactor: external requests + IDE Send
both go through mountWorkflows, all observation + control flows
through the Debug dock panel, and the Run-tab Send + history table
provides the fire-and-forget UX with response details.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Final verification

After all 14 tasks land, run the full gate:

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test 2>&1 | tail -30
cd C:/Users/hello/source/cozy-api && pnpm -r typecheck 2>&1 | tail -20
cd C:/Users/hello/source/cozy-api && pnpm -r build 2>&1 | tail -20
```

Manual smoke test: start the IDE, open a workflow with a POST `@core/http-request` trigger, switch to the Run tab. Send a request — see the history table populate with `in-flight` then `ok`/`error`. Open the Debug tab — see the run appear in the list, click it, see the timeline + logs. Hit `curl -X POST http://localhost:3737/your-path` — see a new entry appear in the Debug runs list (but NOT in the Run-tab history, since that's IDE-only). Set a breakpoint via right-click on a node; fire a request; observe pause + step controls in the Debug panel.

Out-of-scope items (workflow hot-reload, service-logger capture, persistent history) are deferred per the spec's §9.
