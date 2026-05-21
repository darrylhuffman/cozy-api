# Debugger / Run panel — design

**Date:** 2026-05-21
**Subsystem:** #7 of the lorien-api design (`docs/superpowers/specs/2026-05-20-cozy-api-design.md` §3.7)
**Status:** brainstorm complete, ready for implementation planning

---

## 1. Goal

Land the full §3.7 debugger vision: a user can fire a workflow run from inside the IDE, watch lifecycle events stream into a timeline, set breakpoints on nodes and output ports, and step through the run with continue / step / step-over / replay controls. The dev interpreter pauses at hook points; production codegen is untouched.

### What's in scope

- Async pause hooks on `runWorkflow` (`onBeforeNode`, `onAfterNode`)
- A `DebugSession` state machine + WebSocket endpoint on the dev server
- An IDE Run-tab UI with request builder, trigger selector, step controls, and a lifecycle timeline
- Canvas feedback during a run: status borders (running / completed / errored / paused) and brief edge-fire flashes
- Breakpoint management via canvas right-click → context menu; breakpoint state persists in browser `localStorage`

### What's deferred

- Trace export / save-run-as-test-fixture
- "Pause on error" toggle
- Conditional breakpoints
- Service-mock injection in debug mode
- Inline per-port value badges on the canvas (timeline is the value-viewer)
- Auto-attaching to externally-triggered HTTP requests (only debug-initiated runs in v1)

---

## 2. Architecture

Three layers, each with a focused responsibility.

```
┌──────────── Browser (IDE) ──────────────┐
│  Run tab UI  ⇄  debug-session store     │   localStorage: breakpoints
│              ⇄  ws transport hook       │   (per workflow path)
└─────────────────────────────────────────┘
                    │ WebSocket /api/debug
                    │ JSON command/event protocol
┌──────────── Node (dev server) ──────────┐
│  debug-ws.ts (Hono ws upgrade)          │
│  debug-session.ts (state machine)       │
│  debug-protocol.ts (message types)      │
└─────────────────────────────────────────┘
                    │ async hooks
                    │ + LifecycleEmitter
┌──────────── @cozy/runtime/exec ──────────┐
│  runWorkflow                            │
│   - emits lifecycle events (sync, ff)    │
│   - awaits onBeforeNode / onAfterNode    │
│     hooks (if provided)                 │
└─────────────────────────────────────────┘
```

**Properties preserved by this design:**

- **Prod codegen is untouched.** Runtime hooks are dev-only; `lorien build` still emits plain `await` Hono routes with zero `@cozy/runtime` dependency.
- **Zero overhead when no debugger is attached.** `onBeforeNode` / `onAfterNode` are optional. If undefined, the interpreter does no `await`, allocates no promise — non-debug runs run at the same speed they do today.
- **Stateless persistence on the server.** Breakpoints live in browser `localStorage`. The server holds an in-memory mirror only while a WS is connected.
- **One debug session per dev server.** Multiple browser tabs may connect; commands from any tab affect the shared paused run. The most recent `set-breakpoints` replaces the server mirror.

---

## 3. Runtime: hook contract

Two new optional fields on `RunWorkflowOptions` in `packages/runtime/src/exec/run.ts`:

```ts
export interface RunWorkflowOptions {
  // ...existing fields
  lifecycle?: LifecycleEmitter
  onBeforeNode?: (nodeId: string, input: Record<string, unknown>) => Promise<void>
  onAfterNode?: (nodeId: string, output: Record<string, unknown>) => Promise<void>
}
```

### Pause points in `runOneNode`

In execution order:

1. `lifecycle.emit({ type: "edge-fired", ... })` — sync, one per resolved input field
2. `lifecycle.emit({ type: "before-node", ... })` — sync
3. **`await opts.onBeforeNode?.(nodeId, validatedInput)`** — may pause
4. `await nodeDef.run(validatedInput, services)`
5. `lifecycle.emit({ type: "after-node", ... })` — sync
6. **`await opts.onAfterNode?.(nodeId, output)`** — may pause
7. `outputs.set(nodeId, output)`

The `@core/response` short-circuit (existing branch in `runOneNode`) calls `onBeforeNode` with the resolved `{status, body, headers}` so the user can inspect the final response before it's sent. `onAfterNode` is NOT called for the response node — it short-circuits and returns the response immediately after `onBeforeNode` (a port breakpoint on a response node's "outputs" is meaningless; the response node has no outputs).

### Per-port breakpoints

The interpreter does NOT carry per-port semantics. It yields control once per node, after that node fires. The `onAfterNode` hook *implementation* (provided by `DebugSession`) decides whether to pause by checking the active breakpoint set for any `port:*` entry that matches the just-completed node. This keeps the interpreter dumb and the breakpoint matching logic in one place.

### Contract for hook implementations

- Resolving immediately = "continue, no breakpoint hit"
- Holding a pending promise = workflow blocks until that promise settles
- Throwing = treated as the node throwing — wraps into `NodeRunError`, fail-fast semantics fire as today. Used by the `stop` command (hook throws an `AbortError`)

### Behavior unchanged

- Zod input validation runs before `onBeforeNode`. If validation fails, the hook is never called and the workflow halts.
- Fail-fast on `nodeDef.run` throw: `lifecycle.emit({type:"error"})` fires, then `NodeRunError` is thrown. `onAfterNode` is NOT called on error.
- The trigger short-circuit (`if (nodeId === triggerNodeId) ...`) in `runWorkflow` also emits both lifecycle events; for consistency it also calls both hooks (so a `before` breakpoint on the trigger pauses correctly).

---

## 4. Dev server: debug session

Three new files under `packages/runtime/src/dev-server/`.

### 4.1 `debug-protocol.ts` — wire types

JSON over WebSocket. No logic, just types.

```ts
export type ClientMessage =
  | { type: "hello"; breakpoints: Breakpoint[] }
  | { type: "set-breakpoints"; breakpoints: Breakpoint[] }
  | { type: "fire"; workflowPath: string; triggerNodeId: string; request: RequestEnvelope }
  | { type: "continue" }
  | { type: "step" }
  | { type: "step-over" }
  | { type: "replay" }
  | { type: "stop" }

export type ServerMessage =
  | { type: "ready"; sessionId: string }
  | { type: "event"; runId: string; event: LifecycleEvent; offsetMs: number }
  | { type: "paused"; runId: string; nodeId: string; phase: "before" | "after"; payload: unknown }
  | { type: "resumed"; runId: string }
  | { type: "run-complete"; runId: string; status: number; body: unknown; totalMs: number }
  | { type: "run-error"; runId: string; nodeId?: string; message: string }
  | { type: "ack"; for: ClientMessage["type"] }

export interface Breakpoint {
  workflowPath: string
  nodeId: string
  kind: "before" | "after" | `port:${string}`
}

export interface RequestEnvelope {
  method: string
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
}
```

### 4.2 `debug-session.ts` — state machine

One `DebugSession` per dev server instance. Fields:

- `breakpoints: Map<string /* workflowPath */, Breakpoint[]>` — in-memory mirror
- `activeRun: { runId, workflowPath, triggerNodeId, startedAt, lastRequest } | null`
- `activePause: { resolve: () => void; reject: (err: Error) => void } | null`
- `stepMode: "none" | "step" | "step-over"`
- `stepOverNodeId: string | null` — when `stepMode === "step-over"`, the node whose port-bps are suppressed
- `clients: Set<WebSocket>`

Methods:

- `connect(ws)` / `disconnect(ws)` — registry; on disconnect, if `activePause` exists and this was the last client, reject it with `AbortError`
- `onMessage(msg: ClientMessage)` — protocol handler
- `buildHooks(workflowPath: string): { onBeforeNode, onAfterNode }` — returns hook closures for `runWorkflow`. The hooks consult breakpoint registry + stepMode and return either `Promise.resolve()` or a pending pause-promise
- `broadcast(msg: ServerMessage)` — `ws.send` to all clients

**Pause flow inside `buildHooks`:**

```ts
const shouldPause = (nodeId: string, phase: "before" | "after"): boolean => {
  // step: pause at the very next hook call, regardless of bps
  if (this.stepMode === "step") return true

  const bps = this.breakpoints.get(workflowPath) ?? []

  if (phase === "before") {
    // step-over arms a "step" for the NEXT call. When step-over fires onBeforeNode
    // for a DIFFERENT node than stepOverNodeId, we want to pause (we've completed
    // the stepped-over node and are now entering the next one).
    if (this.stepMode === "step-over" && this.stepOverNodeId !== nodeId) return true
    return bps.some(b => b.nodeId === nodeId && b.kind === "before")
  }

  // phase === "after"
  // While stepping over node X, suppress port-bps and after-bps on X itself.
  // We don't pause here; we'll pause at the NEXT node's onBeforeNode.
  if (this.stepMode === "step-over" && this.stepOverNodeId === nodeId) return false
  return bps.some(b => b.nodeId === nodeId && (b.kind === "after" || b.kind.startsWith("port:")))
}

const pause = (nodeId: string, phase: "before" | "after", payload: unknown): Promise<void> => {
  this.broadcast({ type: "paused", runId, nodeId, phase, payload })
  return new Promise((resolve, reject) => { this.activePause = { resolve, reject } })
}

return {
  onBeforeNode: async (nodeId, input) => {
    const willPause = shouldPause(nodeId, "before")
    if (willPause) {
      // Clear step modes on actual pause (arming for next step needs an explicit command)
      this.stepMode = "none"
      this.stepOverNodeId = null
      await pause(nodeId, "before", input)
    }
  },
  onAfterNode: async (nodeId, output) => {
    const willPause = shouldPause(nodeId, "after")
    if (willPause) {
      this.stepMode = "none"
      this.stepOverNodeId = null
      await pause(nodeId, "after", output)
    }
  },
}
```

**Step-over semantics worked example.** Paused at `parseBody.before`, user clicks Step Over:
1. `step-over` command sets `stepMode = "step-over"`, `stepOverNodeId = "parseBody"`, resolves the pause.
2. `parseBody.run` executes. Any port-bps on parseBody are suppressed by `shouldPause(parseBody, "after") → false` in the `step-over && stepOverNodeId === nodeId` branch.
3. `onAfterNode("parseBody", ...)` returns without pausing.
4. The scheduler fires the next ready node, say `validateEmail`. `onBeforeNode("validateEmail", ...)` is called. `shouldPause` sees `stepMode === "step-over" && stepOverNodeId !== "validateEmail"` and returns true. Pause happens.

**Parallel-sibling note.** When the scheduler fires multiple ready nodes concurrently (e.g. validateEmail and hashPassword as siblings of parseBody), step-over will pause at whichever sibling's `onBeforeNode` fires first. v1 does not try to be deterministic about which sibling wins; users can continue/step from that pause to reach the other.

**Command handlers:**

| Message | Behavior |
|---|---|
| `hello` | Replace `breakpoints[workflowPath]` for every path in the payload. Send `ready`. |
| `set-breakpoints` | Same as `hello` — full replace per workflow path. Send `ack`. |
| `fire` | If `activeRun != null` → `run-error`. Else: store envelope, build hooks, build LifecycleEmitter piping to `broadcast({type:"event", ...})`, call `runWorkflow` async. On resolve → `run-complete`. On reject → `run-error`. Always clear `activeRun` after. |
| `continue` | If `activePause`: `pause.resolve()`. Send `resumed`. Else no-op. |
| `step` | Set `stepMode = "step"`. If `activePause`: resolve it. Send `resumed`. |
| `step-over` | If `activePause` is `before`: set `stepMode = "step-over"`, `stepOverNodeId = pausedNodeId`. Resolve. Send `resumed`. Else: no-op (step-over only meaningful from a `before` pause). |
| `replay` | If `activeRun` is `null` and `lastRequest` exists: re-fire with same envelope. Otherwise no-op. |
| `stop` | If `activePause`: `reject(new AbortError("stopped"))`. Workflow aborts via `NodeRunError`. |

### 4.3 `debug-ws.ts` — Hono adapter

Mounts `/api/debug` on the dev server's `Hono` instance, using Hono's WebSocket upgrade. On upgrade:

```ts
ws.onmessage = (msg) => session.onMessage(JSON.parse(msg.data))
ws.onclose   = () => session.disconnect(ws)
session.connect(ws)
```

About 30 lines. No business logic — just wiring.

### 4.4 Fire flow end-to-end

1. Client sends `{ type: "fire", workflowPath: "workflows/users/create.workflow", triggerNodeId: "request", request: {...} }`.
2. Session loads the workflow from the dev server's cached `LoadedWorkflow[]` by path.
3. Calls `buildTriggerSlice(file, triggerNodeId, depsByNode)` — the existing helper in `server.ts`, extracted/reused. Computes the slice's exec plan via `computeExecutionPlan`.
4. Synthesizes `triggerOutputs` from the envelope: `{ body, params: extractParams(triggerValuesPath, envelopePath), query, headers, context: { requestId: runId, timestamp: Date.now() } }`.
5. Resolves services via the existing `createServiceResolver(configServices)` with the run's `{requestId, timestamp}`.
6. Builds a `LifecycleEmitter` that broadcasts every event to all clients as `{type:"event", runId, event, offsetMs}`.
7. Builds hooks via `session.buildHooks(workflowPath)`.
8. Calls `runWorkflow({ workflow, plan, triggerNodeId, triggerOutputs, services, resolveNode, lifecycle, onBeforeNode, onAfterNode })`.
9. On resolve: `broadcast({ type: "run-complete", runId, status, body, totalMs })`. On reject: `broadcast({ type: "run-error", runId, nodeId, message })`. Always `await Promise.allSettled(disposes)` afterwards.

Real HTTP traffic through `mountWorkflows` is completely untouched. Debug runs are a sibling call site for `runWorkflow`.

---

## 5. IDE: Run-tab UI

All UI lives inside `packages/ide/src/panels/inspector-panel.tsx`'s existing `<TabsContent value="run">`. No new dock panel.

### 5.1 Layout

```
┌─────────────────────────────────────────┐
│ Trigger: [POST /users  ▼]   (if 2+)     │
├─────────────────────────────────────────┤
│ Request                                 │
│  method: [POST  ▼]   path: [/users    ] │
│  body:   ┌─────────────────────────┐    │
│          │ { "email": "a@b.com" }  │    │
│          └─────────────────────────┘    │
│  headers ▸                              │
│  query   ▸                              │
│ [ Send ]                                │
├─────────────────────────────────────────┤
│ State: ⏸ Paused at saveUser.before       │
│ [Continue] [Step] [Step Over] [Stop]    │
├─────────────────────────────────────────┤
│ Timeline · 134ms      [< Latest run ▼]  │
│  ┌────────────────────────────────────┐ │
│  │ +0ms    ▸ before  request          │ │
│  │ +0ms    ▸ after   request          │ │
│  │ +12ms   ▾ before  parseBody        │ │
│  │   input: { raw: {...} }            │ │
│  │ +14ms   ▸ after   parseBody        │ │
│  │ +20ms   ⏸ paused  saveUser.before   │ │
│  │ ...                                │ │
│  │ +134ms  ● complete  201             │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 5.2 Component breakdown

- **`<RunTab>`** — top-level. Reads `debug-session` store. Mounts `useDebugTransport()` to establish WS on first mount.
- **`<TriggerSelector>`** — renders if `triggerCount >= 2`. Lists every `@core/http-request` node in the current workflow with `${method} ${path}`. Disabled state: "Add an @core/http-request node first." when count is 0.
- **`<RequestBuilder>`** — method dropdown, path input, JSON body editor (Monaco, fixed 120px height), collapsible headers + query as `<KeyValueGrid>`. Pre-fills from selected trigger's `values:`. State persists in the store (not localStorage — survives tab switches, not page reloads).
- **`<StatusBanner>`** — visible only when `status !== "idle"`. Shows current state and step-control buttons. `[Stop]` shown when `status === "running"`; `[Continue][Step][Step Over]` shown when `status === "paused"`.
- **`<Timeline>`** — virtualized list of events for the selected run. Each row is a `<TimelineEvent>`. `edge-fired` events emitted while resolving a node's inputs are folded into that node's following `before-node` row (badge: `← N inputs`, click to expand and see the resolved values).
- **`<RunPicker>`** — dropdown over the last 10 runs, kept in store. Default: most recent. Selecting an old run swaps the timeline view (canvas state does not re-animate historical runs in v1).

### 5.3 Breakpoint UI on canvas

Already-existing context-menu infrastructure in `workflow-node.tsx` gains two items:

- Right-click node header → "Toggle breakpoint (before)" → toggles `{ workflowPath, nodeId, kind: "before" }` in the store + localStorage
- Right-click an output port row → "Toggle breakpoint (on this output)" → toggles `{ workflowPath, nodeId, kind: "port:${portId}" }`

Visual:
- Node-level breakpoint: small red dot in the top-left corner of the node header
- Port-level breakpoint: red dot overlaid on the port handle

### 5.4 Canvas run-state

`workflow-node.tsx` reads `nodeStatus` from RFNode `data` (populated by `workflow-editor.tsx` from the debug-session store) and applies a CSS class:

| Status | Visual |
|---|---|
| `idle` | normal border |
| `running` | pulse blue border (CSS animation, 1.2s loop) |
| `completed` | green border, fades back to idle 800ms after `run-complete` |
| `errored` | red border, stays until next run starts |
| `paused` | yellow + thicker border, no pulse |

Edges: when an `edge-fired` event arrives, the matching React Flow edge briefly increases its `style.strokeOpacity` from baseline → 1 → baseline over 300ms.

### 5.5 Stores

- **`packages/ide/src/store/debug-session.ts`** (new, Zustand) — fields:
  - `ws: WebSocket | null`, `connected: boolean`
  - `status: "idle" | "running" | "paused" | "completed" | "errored"`
  - `runs: RunRecord[]` (last 10)
  - `selectedRunId: string | null`
  - `pausedFrame: { runId, nodeId, phase, payload } | null`
  - `nodeStatuses: Map<string /* nodeId */, "running" | "completed" | "errored" | "paused">`
  - `breakpoints: Breakpoint[]` (mirrors localStorage)
  - `requestForm: { triggerNodeId, method, path, body, query, headers }` (per active workflow)
  - actions: `applyEvent`, `setStatus`, `setPaused`, `clearPause`, `setBreakpoints`, `toggleBreakpoint`, `setRequestForm`

- **`packages/ide/src/store/debug-breakpoints-storage.ts`** (new) — thin `loadBreakpoints()` / `saveBreakpoints(bps)` localStorage helpers keyed by `"lorien-debug-breakpoints"`. Single JSON blob with `Breakpoint[]` across all workflows.

- **`packages/ide/src/hooks/use-debug-transport.ts`** (new) — opens WS once per app instance (module-scope guard), dispatches inbound messages into the store, exposes `send(msg)`. Reconnects with backoff 1s/2s/5s/10s on disconnect.

### 5.6 What's NOT in this subsystem

- The Tests tab in `inspector-panel.tsx` stays a placeholder (subsystem #9)
- No edits to `tabs.ts` or `selection.ts`
- No edits to `live-workflow.ts` (the workflow data model)
- The Inspect tab's content is unchanged

---

## 6. Error handling, edge cases

### Connection lifecycle

- WS opens on first mount of `<RunTab>` (or once globally if the hook is module-scoped). Survives Run-tab close + reopen.
- On disconnect: `useDebugTransport` retries with backoff 1s → 2s → 5s → 10s → 10s … On reconnect, IDE sends `hello` with the current localStorage breakpoints to fully replace the server mirror.
- If a run is paused when WS disconnects: server's `disconnect()` rejects `activePause` with `AbortError` → run aborts → service `dispose()`s run → next reconnecting client sees `run-error`.

### Race conditions

- **Fire while running:** server replies `{type:"run-error", message:"another run is in flight"}`. IDE disables Send while `status` is not idle/completed/errored.
- **Step command when not paused:** server ignores. (No-op acks are confusing; silent ignore is fine because step is only ever sent from a "paused" UI state.)
- **Set-breakpoints while paused:** takes effect at the next hook call, not retroactively for the current frame.

### Hook hang protection

The hook returns a promise tied to `activePause`. There's no global timeout — debug sessions can legitimately be long. WS disconnect is the implicit cleanup. If the workflow's `nodeDef.run` itself hangs forever (a real bug in user code), that's a separate problem outside the debugger's scope.

### Request envelope edge cases

- Empty body for GET/DELETE: send `body: undefined`. The trigger's `body` output is already filtered by `applyHttpRequestConditional` in `derive-ports.ts`.
- Path params (`/users/:id`): the form shows the concrete path (e.g. `/users/42`); the envelope's `params` is extracted by reusing `extractParams(triggerValuesPath, envelopePath)` from `server.ts`.
- Malformed JSON body: Send button disabled, Monaco shows parse error inline.

### Service lifecycle

Resolved fresh per debug run via existing `createServiceResolver({requestId: runId, timestamp: Date.now()})`. Same code path as real HTTP. `dispose()` is awaited after the workflow resolves, rejects, or aborts.

### Behavior preserved verbatim

- Multi-trigger slicing via `buildTriggerSlice` is reused — a debug run only executes the chosen trigger's subgraph + orphan ancestors.
- `validateWorkflow` errors are reported as `run-error` before any hook fires.

---

## 7. Testing strategy

### Runtime (`@cozy/runtime`)

`packages/runtime/src/exec/run.test.ts` — new cases:
- Hooks not provided → workflow runs identically to today (regression guard for the zero-overhead claim)
- `onBeforeNode` resolves immediately → workflow runs, hook called once per node in order
- `onBeforeNode` rejects with `AbortError` → workflow aborts, dispose()s ran, error is wrapped as `NodeRunError`
- Hook is called *after* Zod input validation, not before (validation failures don't reach the hook)
- `onBeforeNode` IS called for the `@core/response` short-circuit (with the resolved status/body/headers); `onAfterNode` is NOT (response has no outputs and short-circuits)
- Both hooks ARE called for the trigger node short-circuit in `runWorkflow` (so a `before` breakpoint on a trigger fires before downstream nodes; an `after`/port breakpoint on a trigger fires before any downstream node executes)

`packages/runtime/src/dev-server/debug-session.test.ts` — unit:
- `shouldPause` matrix: each combination of `kind` ∈ {`before`, `after`, `port:X`} × phase ∈ {`before`, `after`} × stepMode ∈ {`none`, `step`, `step-over`}
- Command handlers: `continue` resolves pause; `step` sets stepMode; `step-over` from `before` pause sets stepOverNodeId; `stop` rejects with AbortError
- Fire while running → run-error response
- Disconnect while paused → activePause rejects

`packages/runtime/src/dev-server/debug-ws.test.ts` — integration:
- Boot a real Hono app, real WS upgrade, real `fire` against a 3-node workflow, assert lifecycle events stream back in order
- `set-breakpoints` + `fire` + (server pauses) + `continue` round-trip, assert `paused` and `resumed` and `run-complete` events arrive

### IDE (`@cozy/ide`)

`packages/ide/src/store/debug-session.test.ts`:
- `applyEvent` appends to current run's events
- `setPaused` updates `pausedFrame` and `status`
- `toggleBreakpoint` adds/removes and mirrors to localStorage
- `nodeStatuses` cascades from incoming `before-node` / `after-node` / `error` / `complete` events

`packages/ide/src/store/debug-breakpoints-storage.test.ts`:
- Round-trips a `Breakpoint[]`
- Malformed localStorage entry → returns `[]` (no crash)

`packages/ide/src/panels/run-tab.test.tsx`:
- Request builder renders, Send disabled while running, step controls visible only when paused
- Trigger selector renders only when workflow has 2+ http-request nodes; auto-selects single trigger; empty state when 0
- Timeline renders events in order, edge-fired badge collapses into preceding after-node row
- Run picker swaps timeline view

`packages/ide/src/workflow/workflow-node.test.tsx` — added cases:
- Red dot on node header when a `before`/`after` breakpoint exists for this nodeId
- Red dot on output port handle when a matching `port:` breakpoint exists
- Yellow border when `data.nodeStatus === "paused"`, green/red/blue per other statuses
- Pulse-blue animation only when `running`

`packages/ide/src/workflow/workflow-editor.test.tsx`:
- Right-click node header → "Toggle breakpoint (before)" menu item present
- Right-click output port → "Toggle breakpoint (on this output)" menu item present
- Clicking the menu item toggles the breakpoint in the store

### End-to-end

A single Vitest in `packages/runtime/src/dev-server/`:
- Boots a real dev server with a 3-node workflow in a temp dir
- Opens a real WS client
- Sends `hello` with a `before` breakpoint on node 2
- Sends `fire`
- Asserts `event` messages for before/after on node 1, then `paused` for node 2
- Sends `continue`
- Asserts `resumed`, then events for node 2's after + node 3, then `run-complete` with the expected status/body

---

## 8. Out-of-scope (v2+)

- Pause-on-error toggle
- Conditional breakpoints (`breakpoint when input.userId === 42`)
- Service mock injection per debug run
- Auto-attach to externally-triggered HTTP requests (curl/Postman traffic also showing up in the timeline)
- Replay-as-test: convert a recorded run into a Vitest test fixture
- Inline per-port value badges on the canvas
- Multi-stepping ("step 3 nodes")
- Reverse-step / time-travel
- Trace export to file

---

## 9. File map (preview for the plan)

**Create (runtime):**
- `packages/runtime/src/dev-server/debug-protocol.ts`
- `packages/runtime/src/dev-server/debug-session.ts`
- `packages/runtime/src/dev-server/debug-session.test.ts`
- `packages/runtime/src/dev-server/debug-ws.ts`
- `packages/runtime/src/dev-server/debug-ws.test.ts`

**Modify (runtime):**
- `packages/runtime/src/exec/run.ts` — `onBeforeNode` / `onAfterNode` hook awaits
- `packages/runtime/src/exec/run.test.ts` — hook coverage
- `packages/runtime/src/dev-server/server.ts` — export `buildTriggerSlice` + `extractParams` for reuse by debug-session
- `packages/runtime/src/dev-server/start.ts` — mount `/api/debug` via `debug-ws.ts`
- `packages/runtime/src/index.ts` — re-export protocol types for IDE consumption

**Create (IDE):**
- `packages/ide/src/store/debug-session.ts`
- `packages/ide/src/store/debug-session.test.ts`
- `packages/ide/src/store/debug-breakpoints-storage.ts`
- `packages/ide/src/store/debug-breakpoints-storage.test.ts`
- `packages/ide/src/hooks/use-debug-transport.ts`
- `packages/ide/src/panels/run-tab.tsx` (the contents that currently live as a placeholder inside `inspector-panel.tsx`)
- `packages/ide/src/panels/run-tab.test.tsx`
- `packages/ide/src/panels/run-tab/` — subdir for `<TriggerSelector>`, `<RequestBuilder>`, `<StatusBanner>`, `<Timeline>`, `<RunPicker>`

**Modify (IDE):**
- `packages/ide/src/panels/inspector-panel.tsx` — replace Run placeholder with `<RunTab />`
- `packages/ide/src/workflow/workflow-node.tsx` — node-status border classes; breakpoint dots
- `packages/ide/src/workflow/workflow-editor.tsx` — feed `nodeStatuses` from debug-session store into RFNode data; right-click context menu items for breakpoints
- `packages/ide/src/lib/api.ts` — none (WS is handled by `use-debug-transport`)
