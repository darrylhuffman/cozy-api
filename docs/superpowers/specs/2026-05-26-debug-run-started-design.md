# Debug panel: `run-started` server message — design

**Date:** 2026-05-26
**Subsystem:** debugger (subsystem #7)
**Status:** brainstorm complete, ready for implementation planning
**Predecessor spec:** `docs/superpowers/specs/2026-05-26-debugger-http-refactor-design.md`

---

## 1. Goal

The Debug dock panel shows every run on the dev server — IDE-initiated and external (curl/Postman). Today its runs-list row reads `r.request.method` and `r.request.path`, but the server has no way to tell the IDE what request initiated a run. The IDE store lazy-creates `RunRecord`s from incoming `event` messages with hardcoded placeholders (`{ method: "GET", path: "/" }`), so every row in the panel says `GET /` regardless of the real request.

This spec adds a single new server-to-client wire message — `run-started` — broadcast synchronously before the first lifecycle event of a run. It carries the full `RequestEnvelope` (method, path, query, headers, body) so the panel renders real values for IDE Send *and* curl/Postman traffic symmetrically.

### In scope

- New `run-started` `ServerMessage` type in `debug-protocol.ts`
- `DebugIntegration.buildRun` signature extended to accept `triggerNodeId` and `request: RequestEnvelope`
- `mountWorkflows` handler builds the envelope and passes it to `buildRun`
- IDE-side `buildRun` (in `commands/ide.ts`) broadcasts `run-started` before `registerRun`
- IDE store handles `run-started` (creates `RunRecord` with real values); existing lazy-create on unknown-runId `event` becomes a defensive warn-and-create fallback
- Tests at each layer (runtime, build, ide, e2e)

### Deferred

- Header redaction (auth, cookie) — WS is loopback-only and dev-only; revisit if the dev server ever becomes non-local
- Body truncation — bodies can be large; revisit if profiling shows wire pressure
- Linking IDE history-table entries to Debug-panel runs by `runId` — currently independent
- Trigger-template path in the envelope (only concrete `url.pathname` is sent)

---

## 2. Protocol change

`packages/runtime/src/dev-server/debug-protocol.ts`:

- Update the comment on `RequestEnvelope` — it appears on the wire in the new `run-started` message (only).
- Add to `ServerMessage`:

```ts
| {
    type: "run-started"
    runId: string
    workflowPath: string
    triggerNodeId: string
    request: RequestEnvelope
  }
```

`RequestEnvelope` already exists with `{ method, path, query?, headers?, body? }` — no shape change.

### Field semantics

| Field | Source |
|-------|--------|
| `runId` | `opts.debug.newRunId()` (existing) |
| `workflowPath` | `wf.relativePath` (existing) |
| `triggerNodeId` | the trigger node id the handler was registered for |
| `request.method` | `c.req.method` |
| `request.path` | `url.pathname` — the **concrete** request path, not the trigger template (`/users/abc123`, not `/users/:id`) |
| `request.query` | flat string map from `url.searchParams` (existing handler extraction) |
| `request.headers` | all headers `c.req.raw.headers` exposed (existing handler extraction) |
| `request.body` | already-parsed body from the handler (JSON-parsed when content-type is application/json, raw text otherwise, `null` if absent) |

---

## 3. DebugIntegration interface

`packages/runtime/src/dev-server/server.ts`:

Current shape:

```ts
buildRun(runId: string, workflowPath: string): {
  lifecycle?: LifecycleEmitter
  onBeforeNode?: ...
  onAfterNode?: ...
}
```

New shape:

```ts
buildRun(
  runId: string,
  workflowPath: string,
  triggerNodeId: string,
  request: RequestEnvelope,
): { lifecycle?, onBeforeNode?, onAfterNode? }
```

The runtime exposes the new args; it does *not* broadcast. The broadcast belongs to the consumer (IDE command), which has the `debugSession.broadcast` reference.

---

## 4. Server emit point

In `packages/runtime/src/dev-server/server.ts` inside `mountWorkflows`:

```ts
const handler = async (c) => {
  const runId = opts.debug?.newRunId() ?? crypto.randomUUID()
  const startedAt = Date.now()

  // ... existing body/query/headers extraction ...

  const request: RequestEnvelope = {
    method: c.req.method,
    path: url.pathname,
    ...(Object.keys(query).length ? { query } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(body !== null ? { body } : {}),
  }

  const run = opts.debug?.buildRun(runId, wf.relativePath, nodeId, request)

  // ... runWorkflow + onResult/onError (existing) ...
}
```

`opts.debug?.buildRun(...)` runs synchronously (no `await`), and the IDE-command implementation calls `debugSession.broadcast(...)` synchronously inside it. The `run-started` message is on the wire before the next `await runWorkflow(...)` yields, which guarantees ordering ahead of every lifecycle `event` for the same `runId`.

---

## 5. IDE-command `buildRun`

In `packages/build/src/commands/ide.ts`, the existing `buildRun` body:

```ts
buildRun: (runId, workflowPath, triggerNodeId, request) => {
  const startedAt = Date.now()
  const lifecycle = new LifecycleEmitter()

  debugSession.broadcast({
    type: "run-started",
    runId,
    workflowPath,
    triggerNodeId,
    request,
  })

  // ... existing lifecycle subscription + registerRun (unchanged) ...
}
```

The broadcast goes out before `registerRun` so the IDE has a `RunRecord` ready by the time it sees the first `before-node` event.

---

## 6. IDE store changes

`packages/ide/src/store/debug-session.ts`:

New case in `applyMessage`:

```ts
case "run-started": {
  const { runId, workflowPath, triggerNodeId, request } = msg
  set((s) => {
    if (s.runs.find((r) => r.runId === runId)) return s   // idempotent
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

Existing lazy-create-on-`event` for unknown `runId` is **kept** but downgraded:

- Uses placeholder `{ method: "?", path: "?" }`
- Adds `console.warn("[debug-session] event arrived before run-started for runId=" + runId)`

In normal operation this fallback never fires. It only protects against a stale IDE bundle running against a newer server (or vice versa) during hot-reload.

The `RunRecord.workflowPath` and `RunRecord.triggerNodeId` fields stop being empty strings — both are real for `run-started`-originated records and remain empty strings for fallback records.

---

## 7. Error handling

- **Malformed `run-started`**: the IDE store narrows the message by `type` only; missing fields would surface as TypeScript narrowing failures at compile time. Runtime: if a hand-crafted server sends garbage, the `set()` callback would create a malformed record; consumers (`runs-list`) already render via optional chaining for status and would just show empty cells. Not a real concern — server and IDE ship together.
- **Duplicate `run-started`**: idempotent (`runs.find` check). No error logged because the spec doesn't require ordering guarantees beyond "run-started before events for the same runId".
- **`run-started` after an `event` for the same runId** (theoretical): the lazy-create has already created a fallback record. The `run-started` handler short-circuits via the `find` check, so the fallback's placeholder `request` would persist. Acceptable — this race shouldn't happen given synchronous broadcast in §4. Not worth a merge path.

---

## 8. Testing

| Layer | File | Assertion |
|-------|------|-----------|
| Runtime — handler | `packages/runtime/src/dev-server/server.test.ts` | Mock `DebugIntegration`. Fire a request. `buildRun` is called with `(runId, workflowPath, triggerNodeId, request)` where `request` matches the handler's view of the HTTP message. |
| Build — IDE command | `packages/build/src/commands/ide.test.ts` | Mock `DebugSession.broadcast`. Trigger the IDE command's `buildRun`. Assert exactly one `run-started` message broadcast, before any `registerRun` side effect. |
| IDE store — happy path | `packages/ide/src/store/debug-session.test.ts` | `applyMessage({ type: "run-started", ... })` → new RunRecord with real method/path/envelope; `selectedRunId` set if previously null. |
| IDE store — events after | same | Apply `run-started`, then a `before-node` `event` for the same runId. Assert the record's `events.length === 1` (no duplicate from lazy-create). |
| IDE store — defensive lazy-create | same | Apply an `event` for an unknown runId without prior `run-started`. Assert placeholder record created with `method: "?"` and a `console.warn` was emitted. |
| E2E — wire ordering | `packages/runtime/src/dev-server/debug-e2e.test.ts` | Connect WS. Fire HTTP request. Collect WS messages. Assert: first message for the new runId is `run-started` with the correct envelope; subsequent messages are `event`s, `run-complete`, etc. |

---

## 9. Files touched

- `packages/runtime/src/dev-server/debug-protocol.ts` — add `run-started` to `ServerMessage`; update `RequestEnvelope` comment
- `packages/runtime/src/dev-server/server.ts` — extend `DebugIntegration.buildRun` signature; build envelope in handler; pass to `buildRun`
- `packages/runtime/src/dev-server/server.test.ts` — update existing tests for new signature; add assertion
- `packages/runtime/src/dev-server/debug-e2e.test.ts` — add ordering assertion
- `packages/build/src/commands/ide.ts` — update `buildRun` callsite signature; add broadcast
- `packages/build/src/commands/ide.test.ts` — add broadcast assertion
- `packages/ide/src/store/debug-session.ts` — add `run-started` case; downgrade lazy-create
- `packages/ide/src/store/debug-session.test.ts` — three new tests (happy path, events after, defensive)
- `packages/ide/src/hooks/use-debug-transport.ts` (if it exists and types messages) — extend message-type union

---

## 10. Out-of-scope follow-ups (logged here so they're not forgotten)

- Linking IDE history-table entries to runIds. The Send button already creates a history entry and the server mints a runId. A `X-Lorien-RunId` header pre-mint or a `history-id` correlation pass would let the two views cross-link (click a history row → focus that debug run, and vice versa). Worth doing once the panel is feature-complete; not needed for the bug at hand.
- Showing request body/headers/query in `SelectedRunView` for non-IDE traffic. Today only the runs-list row needs method+path. Once `run-started` is on the wire, the SelectedRunView can expose the full envelope similarly to how the IDE history-table renders it.
- Trigger-template path. The wire carries the concrete `url.pathname`. If the panel later wants to show `/users/:id (matched as /users/abc123)`, the server can include `triggerPath` alongside `request.path`.
