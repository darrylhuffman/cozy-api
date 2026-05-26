# Debugger HTTP refactor + multi-active runs — design

**Date:** 2026-05-26
**Subsystem:** debugger (subsystem #7) — major rework
**Status:** brainstorm complete, ready for implementation planning
**Predecessor specs:** `docs/superpowers/specs/2026-05-21-debugger-run-panel-design.md` (initial debugger), `docs/superpowers/specs/2026-05-25-request-body-picker-design.md` (body picker)

---

## 1. Goal

Reverse which layer owns "firing a debug run". Today the IDE owns it via the WS `fire` command, which calls `runWorkflow` directly inside `DebugSession`. The real-HTTP path (used by curl/Postman) bypasses debug entirely. This refactor moves firing into the real HTTP path: `mountWorkflows`'s handler attaches debug hooks per-request, so external requests AND IDE-initiated requests both go through the same code path and both trigger breakpoints.

The IDE Send button becomes a real `fetch` call against the dev server. The WS becomes pure observe + control: lifecycle events, log lines, `paused`/`resumed`/`run-complete`/`run-error` broadcasts going down; `set-breakpoints`/`continue`/`step`/`step-over`/`stop` going up — every step command now carries an explicit `runId`.

The DebugSession state model becomes multi-active: each in-flight HTTP request gets its own runId and its own pause state. Multiple requests can pause simultaneously; a new top-level Debug dock panel lists them and lets the user focus one for stepping.

### In scope
- `mountWorkflows` accepts an optional `debug` integration (factory for per-request runId, lifecycle emitter, hooks, result/error callbacks)
- `DebugSession` state becomes per-run (Map keyed by runId)
- Protocol: every step command carries `runId`; `fire` and `replay` commands removed
- IDE: Send → real HTTP via `restBase()`; CORS on dev server for IDE origin
- IDE: new Debug dock panel (runs list, timeline tab, logs tab, step controls per selected run)
- IDE: Run tab gains a request-history table (client-side memory, status indicator, expandable response details)
- Console capture: node `console.{log,info,warn,error}` calls during a run are tagged with runId via `AsyncLocalStorage` and broadcast as a new `log` server message
- Error stacks attached to `run-error` and lifecycle `error` events

### Deferred
- Service-logger capture (only console.* captured in v1)
- Workflow hot-reload on file save (`loadedWorkflows` snapshot is still boot-time)
- Per-run pause UI in a paused-runs panel — instead, runs list shows pause state inline
- Pause-on-error toggle
- gRPC / non-HTTP triggers

---

## 2. Architecture

```
                                  ┌────────────────────────────────────┐
  Browser (IDE)                   │  Node (dev server, Hono)            │
                                  │                                    │
  Run tab                         │  mountWorkflows handler             │
   ├ trigger picker               │   ├ debug.newRunId() → runId        │
   ├ request builder              │   ├ debug.buildRun(runId, path)     │
   ├ Send ──────HTTP fetch───────►│   │   → lifecycle + hooks           │
   └ history table                │   ├ withRunContext(runId, () =>     │
                                  │   │   runWorkflow(..., lifecycle,   │
  Debug dock panel    WebSocket   │   │            onBefore/onAfter))   │
   ├ runs list   ◄────events───── │   ├ debug.onResult / onError        │
   ├ timeline tab                 │   ├ returns HTTP Response           │
   ├ logs tab                     │   ├ console.* captured via ALS      │
   └ step ctrls  ─────commands──► │   │   → log message broadcast       │
       { runId }                  │   └ DebugSession.runs map per-run   │
                                  │                                    │
  curl / Postman ───HTTP─────────►│  same handler, same path            │
                                  └────────────────────────────────────┘
```

### Key properties

- **One run path, all debuggable.** Anything that hits the dev server's HTTP routes — IDE Send, curl, Postman, browser, integration tests — goes through `mountWorkflows`'s handler and gets the same debug treatment.
- **Zero overhead when no debug integration provided.** `mountWorkflows` calls `opts.debug?.newRunId()` etc. — when `debug` is undefined the code path is identical to today's non-debug behavior.
- **No special-case `fire`.** The IDE doesn't have a privileged way to trigger workflows. It's just an HTTP client like any other.
- **Multi-active runs.** Each request gets its own runId and pause state. Pausing one doesn't affect others.
- **WS is observation + control only.** Subscribe to events, set breakpoints, send step commands. Firing is HTTP.
- **History and runs are separate concerns.** The Run-tab history table is the IDE's record of what it HTTP-fired (client memory). The Debug-panel runs list is the universe of all server-side runs (HTTP + external).

---

## 3. Server side

### 3.1 `MountOptions.debug` interface

`packages/runtime/src/dev-server/server.ts`:

```ts
export interface DebugIntegration {
  /** Allocate a runId for this incoming request. Called once at handler entry. */
  newRunId: () => string

  /**
   * Build per-request debug bindings. Returns the lifecycle emitter to pass
   * to runWorkflow and the optional pause hooks. Called once per request.
   */
  buildRun: (runId: string, workflowPath: string) => {
    lifecycle: LifecycleEmitter
    onBeforeNode?: (nodeId: string, input: Record<string, unknown>) => Promise<void>
    onAfterNode?: (nodeId: string, output: Record<string, unknown>) => Promise<void>
  }

  /** Called when runWorkflow resolves cleanly. */
  onResult: (runId: string, result: WorkflowRunResult, totalMs: number) => void

  /** Called when runWorkflow throws. */
  onError: (runId: string, err: unknown, totalMs: number) => void
}

export interface MountOptions {
  nodes: Record<string, AnyNodeOrTrigger>
  services: Services
  debug?: DebugIntegration  // NEW; replaces the old `lifecycle?` field
}
```

The pre-existing `MountOptions.lifecycle?: LifecycleEmitter` field is removed. (Search confirms it had no production callers — only the DebugSession.runFire which is also being removed.)

### 3.2 Handler rewrite

`mountWorkflows`'s per-request handler becomes:

```ts
const handler = async (c: Context): Promise<Response> => {
  // Parse body, query, headers (unchanged)
  // ... existing parsing logic ...

  const runId = opts.debug?.newRunId() ?? crypto.randomUUID()
  const startedAt = Date.now()
  const run = opts.debug?.buildRun(runId, wf.relativePath)

  try {
    const result = await withRunContext(runId, () =>
      runWorkflow({
        workflow: projectedFile,
        plan,
        triggerNodeId: nodeId,
        triggerOutputs: { body, params, query, headers, context: { requestId: runId, timestamp: startedAt } },
        services: opts.services,
        resolveNode: (uses) => resolveCoreNode(uses) ?? opts.nodes[uses] ?? null,
        ...(run?.lifecycle ? { lifecycle: run.lifecycle } : {}),
        ...(run?.onBeforeNode ? { onBeforeNode: run.onBeforeNode } : {}),
        ...(run?.onAfterNode ? { onAfterNode: run.onAfterNode } : {}),
      }),
    )
    opts.debug?.onResult(runId, result, Date.now() - startedAt)
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json", ...result.headers },
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
```

`withRunContext` comes from the new `console-capture.ts` (§3.5).

### 3.3 `DebugSession` multi-active state

`packages/runtime/src/dev-server/debug-session.ts` rewrites significantly. New shape:

```ts
interface PauseFrame {
  runId: string
  nodeId: string
  phase: "before" | "after"
}

interface RunDebugState {
  runId: string
  workflowPath: string
  startedAt: number
  pause: { resolve: () => void; reject: (e: Error) => void; frame: PauseFrame } | null
  stepMode: "none" | "step" | "step-over"
  stepOverNodeId: string | null
}

export class DebugSession {
  private breakpoints = new Map<string, Breakpoint[]>()
  private clients = new Set<WebSocket>()
  private runs = new Map<string, RunDebugState>()

  // ...
}
```

Methods replacing the old single-active API:

- `registerRun(workflowPath: string, runId: string, startedAt: number): { onBeforeNode, onAfterNode }` — creates a new `RunDebugState`, records `startedAt`, returns hooks closed over that runId's state. Replaces the old `buildHooks(workflowPath, runId)`.
- `unregisterRun(runId: string): void` — called by the DebugIntegration's `onResult` and `onError`. Removes the run entry.
- `getRunStartedAt(runId: string): number | null` — looks up a registered run's start time. Used by the console-capture handler to compute `offsetMs` for `log` messages. Returns null when the runId isn't registered (e.g., a log fires after the run already completed).
- `onMessage(ws, msg)` — handles commands with `runId`: looks up the matching `RunDebugState`, operates on it.

Commands behave per-run:

- `continue { runId }` — resolves `runs.get(runId).pause` if set; broadcasts `resumed { runId }`. Unknown or unpaused runId is a no-op.
- `step { runId }` — sets `runs.get(runId).stepMode = "step"`; resolves pause; broadcasts resumed.
- `step-over { runId }` — same as today's logic, scoped to that run.
- `stop { runId }` — rejects that run's pause with `AbortError`.

Disconnect (last client) rejects ALL active pauses across all runs.

### 3.4 `ide.ts` wires the integration

```ts
import { installConsoleCapture } from "./console-capture.js"

const session = new DebugSession()

installConsoleCapture(({ runId, level, message }) => {
  const startedAt = session.getRunStartedAt(runId)
  if (startedAt === null) return // log fired outside any active run
  session.broadcast({ type: "log", runId, level, message, offsetMs: Date.now() - startedAt })
})

const debug: DebugIntegration = {
  newRunId: () => `r-${Math.random().toString(36).slice(2, 10)}`,
  buildRun: (runId, workflowPath) => {
    const startedAt = Date.now()
    const lifecycle = new LifecycleEmitter()
    const broadcast = (event: LifecycleEvent) => {
      // Serialize Error → {message, stack?} for the wire
      const wireEvent =
        event.type === "error"
          ? { type: "error" as const, nodeId: event.nodeId, error: { message: event.error.message, stack: event.error.stack } }
          : event
      session.broadcast({ type: "event", runId, event: wireEvent as never, offsetMs: Date.now() - startedAt })
    }
    for (const t of ["before-node", "after-node", "edge-fired", "error", "complete"] as const) {
      lifecycle.on(t, broadcast as never)
    }
    const hooks = session.registerRun(workflowPath, runId, startedAt)
    return { lifecycle, onBeforeNode: hooks.onBeforeNode, onAfterNode: hooks.onAfterNode }
  },
  onResult: (runId, result, totalMs) => {
    session.broadcast({ type: "run-complete", runId, status: result.status, body: result.body, totalMs })
    session.unregisterRun(runId)
  },
  onError: (runId, err, totalMs) => {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    const nodeId = err && typeof err === "object" && "nodeId" in err ? ((err as { nodeId: unknown }).nodeId as string | undefined) : undefined
    session.broadcast({ type: "run-error", runId, ...(nodeId ? { nodeId } : {}), message, ...(stack ? { stack } : {}) })
    session.unregisterRun(runId)
    void totalMs
  },
}

// CORS for all routes (loopback-only) before mounting workflows
import { cors } from "hono/cors"
app.use("*", cors({
  origin: (origin) => (isLoopbackOriginString(origin) ? origin : null),
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["content-type", "authorization"],
}))

mountWorkflows(app, loadedWorkflows, { nodes: loadedNodes, services: loadedServices, debug })
```

`isLoopbackOriginString` already exists in `agent-broker/server.ts`. We export it from a shared module (e.g., `runtime/dev-server/cors.ts`) so both call sites use the same predicate.

The old `DebugSession.runFire`, the WS `fire` handler, and the WS `replay` handler are deleted entirely.

### 3.5 Console capture (`console-capture.ts`)

```ts
import { AsyncLocalStorage } from "node:async_hooks"

interface RunContext { runId: string }
const runContext = new AsyncLocalStorage<RunContext>()

let installed = false
let handler: ((e: { runId: string; level: "log"|"info"|"warn"|"error"; message: string }) => void) | null = null

export function installConsoleCapture(onLog: NonNullable<typeof handler>): void {
  handler = onLog
  if (installed) return
  installed = true
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error }
  for (const level of ["log", "info", "warn", "error"] as const) {
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

export function withRunContext<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  return runContext.run({ runId }, fn)
}

function formatArg(a: unknown): string {
  if (a instanceof Error) return a.stack ?? a.message
  if (typeof a === "string") return a
  try { return JSON.stringify(a) } catch { return String(a) }
}
```

Properties:
- Idempotent — installing twice updates the handler but doesn't re-patch console
- When `runContext` has no current store, logs pass through to the original console (server's own logs aren't captured)
- AsyncLocalStorage propagates through `await`, `Promise.then`, `queueMicrotask`, and Node's timers (verified behavior in Node ≥16)

---

## 4. Protocol

`packages/runtime/src/dev-server/debug-protocol.ts`:

```ts
export type ClientMessage =
  | { type: "hello"; breakpoints: Breakpoint[] }
  | { type: "set-breakpoints"; breakpoints: Breakpoint[] }
  | { type: "continue"; runId: string }
  | { type: "step"; runId: string }
  | { type: "step-over"; runId: string }
  | { type: "stop"; runId: string }
// REMOVED: fire, replay

export type ServerMessage =
  | { type: "ready"; sessionId: string }
  | { type: "event"; runId: string; event: WireLifecycleEvent; offsetMs: number }
  | { type: "paused"; runId: string; nodeId: string; phase: "before" | "after"; payload: unknown }
  | { type: "resumed"; runId: string }
  | { type: "run-complete"; runId: string; status: number; body: unknown; totalMs: number }
  | { type: "run-error"; runId: string; nodeId?: string; message: string; stack?: string }
  | { type: "log"; runId: string; level: "log"|"info"|"warn"|"error"; message: string; offsetMs: number }
  | { type: "ack"; for: ClientMessage["type"] }

// Wire-friendly variant: Error becomes {message, stack?}
export type WireLifecycleEvent =
  | { type: "before-node"; nodeId: string; input: Record<string, unknown> }
  | { type: "after-node"; nodeId: string; output: Record<string, unknown>; durationMs: number }
  | { type: "edge-fired"; from: string; to: string; value: unknown }
  | { type: "error"; nodeId: string; error: { message: string; stack?: string } }
  | { type: "complete"; totalMs: number }
```

`RequestEnvelope` is retained as a type for IDE-side use (history records, `lastFire` for replay) but no longer appears in any protocol message.

---

## 5. IDE side

### 5.1 Run tab

`packages/ide/src/panels/run-tab/`:

- `index.tsx` — `<RunTab>` mounts `useDebugTransport()`, renders:
  - `<TriggerSelector />` (always-visible shadcn Select)
  - `<RequestBuilder />` (existing — picker, editor, headers/query, Send button)
  - `<HistoryTable />` (new)

- `history-table.tsx` (new) — renders `useRequestHistoryStore().entries`:
  - One row per entry
  - Columns: time / method+path / status indicator
  - Status indicator: spinner for `in-flight`; green dot for 2xx; red dot for 4xx/5xx/error
  - Click row → expands inline to show: status code, response headers (collapsible), response body (pretty-printed JSON when content-type indicates JSON, raw text otherwise)
  - Per-row "Replay" button → re-issues the same request

- `trigger-selector.tsx` (existing — modified) — replace bare `<select>` with shadcn `<Select>`; ALWAYS render the picker when triggers exist (today it auto-hides for the single-trigger case). The single-trigger case shows a dropdown with one option — the goal is the user always sees which trigger they're targeting.

- `request-builder.tsx` (existing — modified) — `SendButton.onClick` is rewritten:

  ```ts
  const onClick = async () => {
    if (!form.triggerNodeId || !workflowPath) return
    const r = serializeBody(form)
    if (r.error !== undefined) { setBodyError(r.error); return }
    setBodyError(null)

    const url = new URL(`${restBase()}${form.path}`)
    for (const [k, v] of form.query) if (k.length > 0) url.searchParams.set(k, v)

    const headers: Record<string, string> = {}
    for (const [k, v] of form.headers) if (k.length > 0) headers[k] = v

    let bodyInit: BodyInit | undefined
    if (r.body !== undefined) {
      bodyInit = typeof r.body === "string" ? r.body : JSON.stringify(r.body)
      if (typeof r.body !== "string" && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/json"
      }
    }

    const envelope: RequestEnvelope = { method: form.method, path: form.path, ...(r.body !== undefined ? { body: r.body } : {}), ...(form.query.length ? { query: Object.fromEntries(form.query.filter(([k]) => k)) } : {}), ...(form.headers.length ? { headers: Object.fromEntries(form.headers.filter(([k]) => k)) } : {}) }
    const entryId = addHistoryEntry({ workflowPath, triggerNodeId: form.triggerNodeId, request: envelope, startedAt: Date.now() })

    try {
      const startedAt = Date.now()
      const res = await fetch(url.toString(), { method: form.method, headers, body: bodyInit })
      const responseHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => { responseHeaders[k] = v })
      const text = await res.text()
      let body: unknown = text
      const ct = res.headers.get("content-type") ?? ""
      if (ct.includes("application/json")) { try { body = JSON.parse(text) } catch { /* keep text */ } }
      setHistoryResponse(entryId, { status: res.status, headers: responseHeaders, body, durationMs: Date.now() - startedAt })
    } catch (e) {
      setHistoryError(entryId, (e as Error).message)
    }
  }
  ```

### 5.2 Request history store

`packages/ide/src/store/request-history.ts` (new) — Zustand:

```ts
export interface RequestHistoryEntry {
  id: string
  workflowPath: string
  triggerNodeId: string
  request: RequestEnvelope
  startedAt: number
  outcome:
    | { kind: "in-flight" }
    | { kind: "ok"; status: number; headers: Record<string, string>; body: unknown; durationMs: number }
    | { kind: "error"; status: number; headers: Record<string, string>; body: unknown; durationMs: number } // for 4xx/5xx; same shape as ok
    | { kind: "network-error"; message: string }
}

interface State {
  entries: RequestHistoryEntry[] // newest first; cap 20
  addEntry: (e: Omit<RequestHistoryEntry, "id" | "outcome">) => string
  setResponse: (id: string, res: { status: number; headers: Record<string, string>; body: unknown; durationMs: number }) => void
  setError: (id: string, message: string) => void
  clear: () => void
}
```

Naming nit: `setResponse` decides between `ok` and `error` kinds based on `status` (`< 400` → ok, else → error). The history table renders both with response details; only the dot color differs.

### 5.3 Debug dock panel

`packages/ide/src/panels/debug-panel/`:

- `index.tsx` — `<DebugPanel>` rendered by dockview; two-column layout (runs list on left, selected-run view on right). Mobile-friendly fallback: stack vertically if narrow.

- `runs-list.tsx` (new):
  - Reads `useDebugSessionStore.runs` (existing, kept) and `selectedRunId`
  - Renders one row per run, newest first
  - Each row: `time · method path · status badge`
  - Status badge: `⏵ running`, `⏸ at <nodeId>` (paused), `✓ 200` (or other status), `✕ err`
  - Click → `selectRun(runId)`
  - Selected row highlighted

- `selected-run-view.tsx` (new):
  - When no run selected → empty state
  - When a run is selected:
    - `<StatusBanner />` above (existing, moved here, takes selected runId)
    - Tabs: `Timeline` | `Logs`
    - Timeline tab → `<Timeline runId={selectedRunId} />` (existing component, moved here)
    - Logs tab → `<LogsView runId={selectedRunId} />`

- `logs-view.tsx` (new):
  - Reads the selected run's `logs` array from the store
  - One row per log line: `+Xms · LEVEL · message` (truncated; click to expand)
  - Error events from `runs.events` are also surfaced here with their stack trace
  - Filter input at top: filter by level + free-text substring

- `status-banner.tsx` (existing — moved + modified):
  - Accepts a `runId` prop (or reads from `selectedRunId`)
  - Shows the SELECTED run's state (idle if no selection, running/paused/completed/errored otherwise)
  - Step controls send commands with the selected runId

### 5.4 Layout

`packages/ide/src/layout/default-layout.ts`:

```ts
export type PaneId = "files" | "workflow" | "code" | "inspector" | "debug" // add "debug"
export const PANE_IDS = ["files", "workflow", "code", "inspector", "debug"] as const
export const PANE_TITLES: Record<PaneId, string> = {
  files: "Files",
  workflow: "Workflow",
  code: "Code",
  inspector: "Inspector",
  debug: "Debug",
}
```

In `buildDefaultLayout`:
```ts
api.addPanel({
  id: "debug",
  component: "debug",
  title: "Debug",
  position: { referencePanel: "inspector", direction: "within" }, // tab with Inspector
})
```

`reopenPanel` handles `"debug"` similarly to Inspector (right-column placement).

`app.tsx` (or wherever dockview is initialized) registers `debug: <DebugPanel />`.

### 5.5 Store changes (`debug-session.ts`)

- `runs[]` cap raised from 10 → 20
- `RunRecord` gains `pausedFrame?: PausedFrame` (per-run, replacing the old global `pausedFrame`)
- `RunRecord` gains `logs: Array<{ offsetMs; level: "log"|"info"|"warn"|"error"; message: string }>` — populated by inbound `log` messages
- Top-level `pausedFrame`, `nodeStatuses`, `status` fields REMOVED (derived per-run from selectedRunId's RunRecord)
- New helper selectors:
  - `selectedRun(): RunRecord | null`
  - `nodeStatusesFor(runId): Map<nodeId, NodeStatus>` — derived from that run's events
- Step actions take an explicit `runId`:
  - `sendContinue(runId)`, `sendStep(runId)`, `sendStepOver(runId)`, `sendStop(runId)` — emit WS messages
- The WS `fire`/`replay` send paths are removed; nothing in the IDE constructs those messages anymore
- `recordFire` removed; `lastFire` removed — the request history table is the new source of truth for "what did the IDE last fire"

### 5.6 Canvas integration

`workflow-editor.tsx` already feeds `nodeStatuses` into RFNode data. The source changes from the old global `nodeStatuses` field to `nodeStatusesFor(selectedRunId)`:

```ts
const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)
const nodeStatuses = useDebugSessionStore((s) => (s.selectedRunId ? s.nodeStatusesFor(s.selectedRunId) : new Map()))
```

Edge-fired flash subscribes to the selected run's events (same pattern as before, just keyed differently).

If no run is selected → empty Map → no node-status borders on the canvas. Breakpoint dots still render (those are tied to breakpoint state, not run state).

### 5.7 useDebugTransport changes

`packages/ide/src/hooks/use-debug-transport.ts`:

- Outgoing message types updated per the new protocol (no more `fire`/`replay`)
- Existing singleton/refCount/backoff logic unchanged
- `applyMessage` in the store handles the new `log` message type and the extended `run-error.stack` / wire-event `error` field

---

## 6. Error handling + edge cases

| Source | Detection | UI |
|---|---|---|
| Network error (server unreachable) | `fetch` throws | Run-tab history row turns gray with the error message; no Debug panel run record |
| Server returned HTTP error (4xx/5xx) | `fetch` resolves with `!res.ok` | Run-tab history row turns red; expanding shows status + body. The Debug panel run-error event surfaces stack + message in the Logs tab |
| Workflow exception (server-side throw) | WS `run-error` event | History row turns red via the 500 response. Debug panel shows the message inline; stack in Logs tab |
| WS disconnected when IDE Sends | `fetch` still completes via HTTP | History row populates normally. Debug panel doesn't get events — the run is invisible until WS reconnects (then future runs are visible again; this run is lost) |
| Two IDE clients connected | Both see all WS events | Each has its own history; Debug panel runs list is identical across clients |
| Request for unmounted workflow path | 404 from Hono | History row red (4xx); no Debug panel entry |
| Workflow currently editing but unsaved | Dev server snapshot is stale | Pre-existing limitation; same as today; documented as known follow-up |

### Console-capture caveats

- Logs from `setImmediate`/`setTimeout` callbacks ARE captured (AsyncLocalStorage propagates through Node timers since ~v16)
- Logs from spawned subprocesses are NOT captured (different process; no shared ALS)
- Logs from `console.dir`/`console.table` etc. NOT captured (only log/info/warn/error are patched in v1)

---

## 7. Testing

### Runtime (`@cozy/runtime`)

`packages/runtime/src/dev-server/server.test.ts` (existing — extended):
- Mounting with `debug` integration: handler calls `newRunId`, `buildRun`, `onResult` on success; `onError` on workflow throw
- Without `debug`: same behavior as today (regression guard)
- HTTP error response on workflow throw — body is `{error: msg}`, status 500

`packages/runtime/src/dev-server/console-capture.test.ts` (new):
- `installConsoleCapture` patches `console.{log,info,warn,error}`
- Logs inside `withRunContext` are tagged with runId
- Logs outside any context fall through to original console (don't crash, don't emit)
- AsyncLocalStorage propagates through `await`, `Promise.then`, `queueMicrotask`
- Multiple concurrent contexts isolate their logs

`packages/runtime/src/dev-server/debug-session.test.ts` (existing — rework):
- `registerRun(workflowPath, runId)` creates a runs-map entry
- Multiple concurrent runs: each tracks its own pause state and step mode
- Commands target the right run by runId
- `step-over { runId: A }` doesn't affect run B's hooks
- `stop { runId: A }` rejects only A's pause; B continues
- `disconnect` (last client) rejects all active pauses
- `continue { runId: unknown }` is a no-op (no broadcast, no throw)

`packages/runtime/src/dev-server/debug-e2e.test.ts` (existing — replaced):
- Boot real Hono+ws server with `mountWorkflows` + real `DebugSession`
- Open WS client, send `hello` with a breakpoint
- Make a real HTTP request via `fetch`
- Assert: WS receives `event` messages, then `paused`, then after `continue { runId }`, `resumed` + `run-complete`
- Second scenario: two concurrent HTTP requests; both pause; step each independently
- Third scenario: node calls `console.log` → `log` server message arrives over WS with matching runId

### IDE (`@cozy/ide`)

`packages/ide/src/panels/run-tab/send-button.test.tsx` (new or moved):
- Send fires `fetch` to `${restBase()}${form.path}` with the right method/headers/body
- JSON body → `JSON.stringify` + Content-Type defaulted to application/json
- xml/text/form → raw string body
- History entry created with `in-flight` status before fetch
- On 2xx → history entry status `ok`
- On 4xx/5xx → history entry status `error` with the response body
- On network error → history entry status `network-error` with the error message

`packages/ide/src/store/request-history.test.ts` (new):
- `addEntry` returns an id, sets outcome `in-flight`
- `setResponse` patches by id; status < 400 → `ok`, ≥ 400 → `error`
- `setError` patches by id with `network-error`
- Cap at 20 entries; newest first

`packages/ide/src/panels/run-tab/history-table.test.tsx` (new):
- Renders one row per entry
- Spinner shown for `in-flight`
- Green dot for 2xx, red for non-2xx, gray for network-error
- Click expands row to show response details
- Replay button re-issues the same request (delegates to SendButton path)

`packages/ide/src/panels/debug-panel/runs-list.test.tsx` (new):
- Renders one row per run in `useDebugSessionStore.runs`
- Selected run row highlights
- Click changes `selectedRunId`

`packages/ide/src/panels/debug-panel/selected-run-view.test.tsx` (new):
- No run selected → empty state
- Run selected → Timeline + Logs tabs render
- Step controls appear only when the selected run is paused/running
- Step commands emit WS messages with the selected runId

`packages/ide/src/panels/debug-panel/logs-view.test.tsx` (new):
- Renders one row per log line for the selected run
- Filter input narrows the list by substring AND level
- Error-level lines show their stack expandable

`packages/ide/src/store/debug-session.test.ts` (existing — extended):
- `applyMessage` for `log` appends to the matching run's `logs`
- `applyMessage` for `paused` sets that run's `pausedFrame` (not a global field)
- `sendContinue(runId)` / `sendStep(runId)` / etc. emit commands with the right runId
- Selectors: `selectedRun()`, `nodeStatusesFor(runId)`

`packages/ide/src/workflow/workflow-editor.test.tsx` (existing — updated):
- Node statuses are derived from the SELECTED run's events
- Switching selectedRunId updates canvas borders
- No run selected → no status classes applied

---

## 8. File map preview

**Create (runtime):**
- `packages/runtime/src/dev-server/console-capture.ts`
- `packages/runtime/src/dev-server/console-capture.test.ts`
- `packages/runtime/src/dev-server/cors.ts` (exports `isLoopbackOriginString`)

**Modify (runtime):**
- `packages/runtime/src/dev-server/server.ts` — `MountOptions.debug`, handler rewrite, `withRunContext` wrap
- `packages/runtime/src/dev-server/debug-session.ts` — multi-active state, `registerRun`/`unregisterRun`, runId-keyed commands
- `packages/runtime/src/dev-server/debug-session.test.ts` — full rework
- `packages/runtime/src/dev-server/debug-protocol.ts` — protocol changes (commands carry runId; remove fire/replay; add log; extend run-error with stack)
- `packages/runtime/src/dev-server/debug-e2e.test.ts` — replaced
- `packages/runtime/src/agent-broker/server.ts` — `isLoopbackOriginString` re-imports from new shared module (no behavior change)
- `packages/runtime/src/index.ts` — re-export `DebugIntegration`, drop `RequestEnvelope` from re-exports if unused

**Modify (build):**
- `packages/build/src/commands/ide.ts` — replace `DebugSession.runFire`-style wiring with the new `DebugIntegration` factory; add CORS; install console capture

**Create (IDE):**
- `packages/ide/src/store/request-history.ts`
- `packages/ide/src/store/request-history.test.ts`
- `packages/ide/src/panels/run-tab/history-table.tsx`
- `packages/ide/src/panels/run-tab/history-table.test.tsx`
- `packages/ide/src/panels/debug-panel/index.tsx`
- `packages/ide/src/panels/debug-panel/runs-list.tsx`
- `packages/ide/src/panels/debug-panel/runs-list.test.tsx`
- `packages/ide/src/panels/debug-panel/selected-run-view.tsx`
- `packages/ide/src/panels/debug-panel/selected-run-view.test.tsx`
- `packages/ide/src/panels/debug-panel/logs-view.tsx`
- `packages/ide/src/panels/debug-panel/logs-view.test.tsx`

**Modify (IDE):**
- `packages/ide/src/panels/run-tab/index.tsx` — drop Timeline + RunPicker + StatusBanner; add `<HistoryTable />`
- `packages/ide/src/panels/run-tab/trigger-selector.tsx` — shadcn Select; always-visible
- `packages/ide/src/panels/run-tab/request-builder.tsx` — `SendButton` rewritten to `fetch`
- `packages/ide/src/panels/run-tab/status-banner.tsx` — moved/renamed under `debug-panel/`, accepts runId
- `packages/ide/src/panels/run-tab/timeline.tsx` — moved under `debug-panel/`, accepts runId
- `packages/ide/src/store/debug-session.ts` — multi-active model, drop `lastFire`/`recordFire`, add `logs` per run, add selectors
- `packages/ide/src/store/debug-session.test.ts` — extended for multi-active
- `packages/ide/src/hooks/use-debug-transport.ts` — outgoing types updated; inbound `log` dispatch
- `packages/ide/src/layout/default-layout.ts` — add `"debug"` pane
- `packages/ide/src/app.tsx` (or wherever components register) — register `debug` component
- `packages/ide/src/workflow/workflow-editor.tsx` — derive nodeStatuses from selected run

**Delete (eventually, after migration):**
- `packages/ide/src/panels/run-tab/run-picker.tsx` (replaced by Debug runs-list)

---

## 9. Out-of-scope (v3+)

- Hot-reload of `loadedWorkflows` on file save (the dev server captures workflows once at boot)
- Service-logger capture (only `console.*` in v2)
- Filter logs by nodeId (logs are tagged by runId only)
- Persisting request history or runs across IDE page reloads
- Per-run pause-on-error toggle
- Conditional breakpoints
- Multipart/form-data body editor
- Saving requests as named fixtures
- Diffing two runs side-by-side
