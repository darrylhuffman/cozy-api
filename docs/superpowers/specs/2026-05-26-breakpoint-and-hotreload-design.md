# Debugger UX follow-ups: breakpoint path alignment, before/after indicator, workflow hot-reload — design

**Date:** 2026-05-26
**Subsystem:** debugger (subsystem #7)
**Status:** brainstorm complete, ready for implementation planning
**Predecessor specs:**
- `docs/superpowers/specs/2026-05-26-debugger-http-refactor-design.md`
- `docs/superpowers/specs/2026-05-26-debug-run-started-design.md`

---

## 1. Goal

Three follow-ups landed simultaneously after the HTTP-refactor + `run-started` work:

1. **Breakpoint workflow-path alignment** — node breakpoints are silently ignored because the IDE stores them under workspace-root-relative paths (`workflows/user/create.workflow`) while the runtime looks them up under workflows-dir-relative paths (`user/create.workflow`).
2. **Before/After breakpoint indicator** — a single red dot today; the user can't tell visually whether a breakpoint is `before` or `after`. Position-only encoding (left dot = before, right dot = after) carries the semantic at zero visual clutter.
3. **Workflow hot-reload** — `loadedWorkflows` is captured at IDE boot; edits in the canvas require a manual restart. Broad reload on `.workflow` file change with paused-run abort.

These are bundled because all three surface as papercuts during the same debug session. The path fix and indicator are small; hot-reload is the substantial item.

### In scope
- Change `loadWorkspace.relativePath` to be workspace-root-relative.
- Adjust `run-build.ts` codegen output path so the prefix change doesn't double-up.
- Refactor `WorkflowNodeData.hasNodeBreakpoint: boolean` → `nodeBreakpoint: { before: boolean; after: boolean }`. Render two dots.
- Watch `<root>/workflows/**/*.workflow`. On change: broad workspace reload, abort paused runs.

### Deferred (named so they're not forgotten)
- Hot-reload for `.ts` node files (requires tsx-cache invalidation — separate design).
- Hot-reload for `lorien.config.ts` (same module-cache problem).
- Surgical per-workflow reload (architecturally cleaner but Hono doesn't expose unmount; broad reload is sufficient until we hit real performance issues).
- Replay paused-run state across reload (let user resume the same step after edit — too clever, too brittle).

---

## 2. Item 1 — Workflow-path alignment

### Root cause

`packages/runtime/src/dev-server/load.ts:33`:

```ts
relativePath: relative(workflowsDir, abs).replaceAll("\\", "/"),
```

For `<root>/workflows/user/create.workflow`, this produces `"user/create.workflow"`. The IDE's `WorkflowEditor` `path` prop and `/api/workspace/file?path=` API both use workspace-root-relative paths (`"workflows/user/create.workflow"`). The IDE stores breakpoints under that prefixed path; `DebugSession.registerRun` looks up under the unprefixed path. They never match, so `bps.some(...)` always returns false and `shouldPause` returns false.

### Fix

Change `load.ts:33` to:

```ts
relativePath: relative(root, abs).replaceAll("\\", "/"),
```

For the same input file, `relativePath` becomes `"workflows/user/create.workflow"`.

### Downstream consequences

| File | Change |
|------|--------|
| `packages/runtime/src/dev-server/load.test.ts:35` | Assertion updates from `"users/create.workflow"` to `"workflows/users/create.workflow"`. |
| `packages/build/src/build/run-build.ts:61` | The codegen does `wf.relativePath.replace(/\.workflow$/, "")` to get `basePath`, then `join(outDir, "workflows", "${slugifiedPath}.gen.ts")` at line 66. With the new prefixed `relativePath`, we strip the leading `workflows/` from `basePath` so the output path stays at `<outDir>/workflows/user/create.gen.ts` (NOT `<outDir>/workflows/workflows/user/create.gen.ts`). |
| `packages/runtime/src/dev-server/server.ts:44` | Cosmetic — the error message `Skipping ${wf.relativePath}` now logs with the prefix. Free improvement. |
| `packages/runtime/src/dev-server/debug-e2e.test.ts` | Already constructs `LoadedWorkflow` with `relativePath: "workflows/echo.workflow"` (matching the new format) — no change needed. |

The `run-started` message's `workflowPath` field automatically picks up the new format (it forwards `wf.relativePath`). The IDE store's `RunRecord.workflowPath` is now consistent with `WorkflowEditor`'s `path` prop — useful for future canvas↔run correlation.

### Test coverage

- **Add:** unit test in `load.test.ts` that the prefix is present.
- **Add:** integration test against a real `loadWorkspace` that an `after` breakpoint fires (the existing e2e bypasses `loadWorkspace` by constructing the LoadedWorkflow inline — that's how the bug went undetected). The new test uses `loadWorkspace` directly and confirms `DebugSession.shouldPause` returns true for a matching breakpoint.
- **Existing:** all current tests in `load.test.ts`, `run-build` tests, and `debug-e2e.test.ts` must still pass.

---

## 3. Item 2 — Before/After breakpoint indicator

### Today

`WorkflowNodeData.hasNodeBreakpoint: boolean` — true when *any* node-level breakpoint exists. Renders a single red dot on the node header. No way to tell which kind.

### Shape change

```ts
// packages/ide/src/workflow/workflow-node.tsx
interface WorkflowNodeData {
  // ...
  /**
   * Node-level breakpoints. Each side is rendered as a red dot on the
   * corresponding edge of the node header. Both can be true.
   */
  nodeBreakpoint?: { before: boolean; after: boolean }
  // ...
}
```

The old `hasNodeBreakpoint` field is REMOVED — no migration shim, this is internal state assembled fresh each render in `workflow-editor.tsx`.

### Derivation

`packages/ide/src/workflow/workflow-editor.tsx` (around line 562):

```ts
const nodeBreakpoint = {
  before: bps.some((b) => b.kind === "before"),
  after: bps.some((b) => b.kind === "after"),
}
// Replaces: const hasNodeBreakpoint = bps.some((b) => b.kind === "before" || b.kind === "after")
```

(Port-level breakpoints — `kind.startsWith("port:")` — remain in their own `portBreakpoints` set and are unaffected.)

### Render

In `workflow-node.tsx`, replace the single dot element with two conditional dots:

- Left-side dot: positioned at the left edge of the header, rendered when `nodeBreakpoint.before` is true.
- Right-side dot: positioned at the right edge of the header, rendered when `nodeBreakpoint.after` is true.

Concrete CSS — small absolutely-positioned circles, `bg-red-500`, `rounded-full`, `w-2 h-2`, anchored to the header element. Left dot uses `left: -4px`; right dot uses `right: -4px`. Vertical center via `top: 50%; transform: translateY(-50%)`. (Follow the existing patterns for any neighbouring overlays — there are likely status badges or similar on the node header.)

Both dots can be visible simultaneously when the user has set both `before` and `after` on the same node.

### Test coverage

- **Update:** existing test `"breakpoints effect sets hasNodeBreakpoint on the matching RFNode"` in `workflow-editor.test.tsx:1612` becomes `"breakpoints effect sets nodeBreakpoint.before / .after on the matching RFNode"` — asserts the new shape.
- **Add:** rendering test in a `workflow-node` test file (if one exists) that verifies the left dot renders when `before: true` and the right dot renders when `after: true`. If no node-level test exists yet, this can live as an additional assertion in the workflow-editor test.

---

## 4. Item 3 — Workflow hot-reload

### Architecture: dispatcher indirection

Today, `runIde` does (simplified):

```ts
const app = createIdeApp(workspaceRoot)
mountWorkflows(app, loadedWorkflows, { nodes: loadedNodes, services: loadedServices, debug })
// ...
serve({ fetch: app.fetch, port: availablePort }, ...)
```

The `serve` call binds one `app.fetch` reference forever. To swap apps on reload, introduce a mutable reference and a dispatcher closure:

```ts
let currentApp: Hono = buildAppForWorkspace({
  workspaceRoot,
  loadedWorkflows,
  loadedNodes,
  loadedServices,
  debug,
})

const dispatcher = (req: Request, env: unknown, ctx: unknown) =>
  currentApp.fetch(req, env, ctx)

serve({ fetch: dispatcher, port: availablePort }, ...)
```

`buildAppForWorkspace` is a small new helper that does exactly what's inline today:

```ts
function buildAppForWorkspace(params: {
  workspaceRoot: string
  loadedWorkflows: LoadedWorkflow[]
  loadedNodes: Record<string, AnyNodeOrTrigger>
  loadedServices: Services
  debug: DebugIntegration
}): Hono {
  const app = createIdeApp(params.workspaceRoot)
  mountWorkflows(app, params.loadedWorkflows, {
    nodes: params.loadedNodes,
    services: params.loadedServices,
    debug: params.debug,
  })
  return app
}
```

### Watcher

Chokidar is already imported in `ide.ts` and wired for SSE workspace-tree notifications. Add a dedicated watcher for `.workflow` files:

```ts
const workflowWatcher = chokidar.watch(
  join(workspaceRoot, "workflows", "**", "*.workflow"),
  { ignoreInitial: true },
)
const debouncedReload = debounce(reloadWorkspace, 100)
workflowWatcher.on("all", debouncedReload)
```

The 100ms debounce coalesces editor-burst writes (some editors emit multiple events per save).

### `reloadWorkspace`

```ts
async function reloadWorkspace(): Promise<void> {
  // 1. Re-load workflows from disk.
  const ws = await loadWorkspace(workspaceRoot)
  const freshWorkflows = ws.workflows
  if (ws.errors.length > 0) {
    for (const e of ws.errors) console.error(`[lorien] ${e.path}: ${e.message}`)
  }

  // 2. Abort any paused or in-flight runs.
  debugSession.abortAllRuns()  // new method — see §4.5

  // 3. Build a fresh app using the SAME debugSession + services + nodes.
  const newApp = buildAppForWorkspace({
    workspaceRoot,
    loadedWorkflows: freshWorkflows,
    loadedNodes,    // out of scope to refresh
    loadedServices, // out of scope to refresh
    debug,
  })

  // 4. Atomic swap.
  currentApp = newApp

  console.log(
    `lorien IDE: reloaded ${freshWorkflows.length} workflow(s)`,
  )
}
```

### Aborting paused runs — new `DebugSession.abortAllRuns()`

Per the design decision: aborting paused runs on reload broadcasts an explicit `run-error` so the user sees a clear signal that their edit invalidated the run.

In `packages/runtime/src/dev-server/debug-session.ts`, add:

```ts
abortAllRuns(): void {
  for (const runId of [...this.runs.keys()]) {
    const state = this.runs.get(runId)
    if (state?.pause) {
      state.pause.reject(new AbortError("run aborted: workflow reloaded"))
    }
    this.broadcast({
      type: "run-error",
      runId,
      message: "Run aborted: workflow reloaded",
    })
    this.runs.delete(runId)
  }
}
```

The existing `mountWorkflows` handler's `try/catch` will see the rejected pause promise propagate, but it already calls `opts.debug?.onError(...)` — that would broadcast a second `run-error`. To avoid duplicate broadcasts: the `abortAllRuns` call removes the run from `this.runs`, but the handler's try/catch still fires. The cleanest path is to let the handler-side broadcast happen (it's the canonical `onError` for that run); `abortAllRuns` then DOES NOT broadcast `run-error` itself, only rejects pause promises and removes runs from the map.

Revised `abortAllRuns`:

```ts
abortAllRuns(): void {
  for (const runId of [...this.runs.keys()]) {
    const state = this.runs.get(runId)
    if (state?.pause) {
      state.pause.reject(new AbortError("run aborted: workflow reloaded"))
    }
    // Don't broadcast run-error here — the handler's catch block does that via
    // opts.debug?.onError(...) when the pause-promise rejection propagates.
    // We just remove the run from the registered set; the handler will call
    // unregisterRun for cleanup but it'll already be gone.
    this.runs.delete(runId)
  }
}
```

In-flight runs that are NOT paused (i.e., currently executing a node) cannot be aborted cleanly because there's no `AbortSignal` plumbed through `runWorkflow`. They will continue executing under the old workflow definition until they hit their next pause point (or complete naturally). This is fine — they're closures already; they have no reference to the new workflow.

### What persists across reload

| State | Persistence |
|-------|-------------|
| `DebugSession` instance | Same instance (preserves breakpoints, WS clients) |
| Connected WebSocket clients | Survives — `attachDebugWebSocket` is on the `currentApp`'s underlying http server, not the Hono app |
| Breakpoints map | Persists |
| `loadedServices` | Persists (config doesn't change) |
| `loadedNodes` | Persists (`.ts` files are deferred) |
| Paused runs | Aborted (see above) |
| In-flight non-paused runs | Continue under old workflow (closure semantics) |
| IDE API routes (`/api/workspace/*`) | Mounted on `newApp` via `createIdeApp` — equivalent behaviour |
| SPA static-file routes | Same — mounted on `newApp` |

### WebSocket: a wrinkle to verify

`attachDebugWebSocket({ app, server, session })` is called once during `runIde` and listens on `server`. The WS is bound to the http server, NOT the Hono app. So WS connections survive the app swap. Good. (Implementation-time verification: read `attachDebugWebSocket` to confirm it doesn't keep a reference into the Hono routes.)

### Watched files

Only `<root>/workflows/**/*.workflow`. Node `.ts` files and `lorien.config.ts` are deferred.

### Logging

On successful reload:

```
lorien IDE: reloaded 3 workflow(s)
```

On reload that introduces errors (e.g., the file is now malformed):

```
[lorien] /abs/path/workflows/user/create.workflow: <parse error>
lorien IDE: reload completed with 1 error(s)
```

Errors do NOT abort the swap — the new app is mounted using whatever workflows did load successfully, matching the boot-time behaviour.

---

## 5. Combined testing notes

- **Item 1 path fix:**
  - `load.test.ts` — assertion change.
  - New unit test: `loadWorkspace` returns `relativePath` workspace-root-relative for nested directories.
  - New e2e test or integration test: spin up `loadWorkspace` + `mountWorkflows` against a fixture; set an `after` breakpoint via the WS `hello`; fire HTTP; assert `paused` message arrives.
- **Item 2 indicator:**
  - `workflow-editor.test.tsx` — existing `hasNodeBreakpoint` test updates to `nodeBreakpoint`.
  - New render test for both dots visible when both kinds are set.
- **Item 3 hot-reload:**
  - Integration test in `packages/build/src/commands/ide.test.ts` (or a new e2e test): start runIde, fire a request, modify the workflow file via `fs.writeFile`, wait for reload, fire another request and verify the new behaviour applies.
  - Unit test for `DebugSession.abortAllRuns()`: register a paused run, call `abortAllRuns`, assert the pause promise rejected and the run is removed.
  - Manual smoke: edit a workflow in the canvas, observe `lorien IDE: reloaded 1 workflow(s)` on stdout, fire a fresh request, see the new behaviour.

---

## 6. Files touched

**Modified:**
- `packages/runtime/src/dev-server/load.ts` — relativePath base change.
- `packages/runtime/src/dev-server/load.test.ts` — assertion update.
- `packages/runtime/src/dev-server/server.ts` — no logic change (the error message benefits from the new format for free).
- `packages/runtime/src/dev-server/debug-session.ts` — new `abortAllRuns()` method.
- `packages/runtime/src/dev-server/debug-session.test.ts` — test the new method.
- `packages/build/src/build/run-build.ts` — strip leading `workflows/` from basePath.
- `packages/build/src/commands/ide.ts` — extract `buildAppForWorkspace`; install workflow watcher; implement `reloadWorkspace`.
- `packages/build/src/commands/ide.test.ts` — hot-reload integration test.
- `packages/ide/src/workflow/workflow-node.tsx` — replace `hasNodeBreakpoint` field; render two dots.
- `packages/ide/src/workflow/workflow-editor.tsx` — derive `nodeBreakpoint` instead of `hasNodeBreakpoint`.
- `packages/ide/src/workflow/workflow-editor.test.tsx` — assertion update for new shape.

**Created:** none.

---

## 7. Confirmed pre-implementation facts (no longer open)

- **`AbortError`:** defined locally as `class AbortError extends Error { override name = "AbortError" }` at `packages/runtime/src/dev-server/debug-session.ts:27-29`. Not exported. Already referenced in `disconnect`, `unregisterRun`, `stopRun`. The new `abortAllRuns` reuses it directly — no changes to the class.
- **`attachDebugWebSocket` is Hono-app-independent.** Defined at `packages/runtime/src/dev-server/debug-ws.ts`. It accepts `{ app, server, session }` but the `app` parameter is unused inside the implementation — the WSS is bound to the HTTP server's `"upgrade"` event directly, and message dispatch only calls `session` methods. After return, no closure holds a reference to `app`. **Conclusion:** call `attachDebugWebSocket` once at startup; do NOT re-call it on hot-reload. Already-connected WS clients survive the `currentApp` swap.

## 8. Open implementation notes (for the plan stage)

- Whether `chokidar.watch` should be a sibling of the existing tree-SSE watcher in `ide.ts`, or share one watcher with multiple handlers. Sibling is simpler — they have different responsibilities. Implementation choice; spec doesn't constrain.
- `debounce` utility — neither lodash nor underscore is in the build package; write a 6-line inline debounce.
