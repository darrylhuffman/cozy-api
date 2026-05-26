# Debugger UX follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the breakpoint workflow-path mismatch that silently ignores `after` breakpoints, add left/right positional indicators for `before`/`after` breakpoints on the node header, and add hot-reload of `.workflow` files so canvas edits propagate to the dev server without a restart.

**Architecture:** Three independent changes. (1) Make `loadWorkspace.relativePath` workspace-root-relative so the IDE's breakpoint paths match. (2) Replace `WorkflowNodeData.hasNodeBreakpoint: boolean` with `nodeBreakpoint: { before: boolean; after: boolean }` and render two positional dots. (3) Install a dispatcher indirection in `runIde` so the Hono app can be swapped in place, watch `<root>/workflows/**/*.workflow` with chokidar, and on change re-run `loadWorkspace` + abort paused runs + atomically swap the app. The single `DebugSession` instance and connected WebSocket clients survive the swap.

**Tech Stack:** TypeScript ESM (NodeNext), pnpm workspaces, Vitest, Hono, chokidar, Zustand (IDE state), `ws`.

**Spec:** `docs/superpowers/specs/2026-05-26-breakpoint-and-hotreload-design.md`

---

## File Structure

**Modified:**
- `packages/runtime/src/dev-server/load.ts` — `relativePath` base changes from `workflowsDir` to `root`.
- `packages/runtime/src/dev-server/load.test.ts` — assertion + nested-dir test.
- `packages/runtime/src/dev-server/debug-session.ts` — new `abortAllRuns()` method.
- `packages/runtime/src/dev-server/debug-session.test.ts` — new tests for `abortAllRuns` and for path-matched breakpoint firing.
- `packages/build/src/build/run-build.ts` — strip leading `workflows/` from basePath before composing codegen output path.
- `packages/build/src/commands/ide.ts` — extract `buildAppForWorkspace`, install dispatcher indirection, install workflow watcher, implement `reloadWorkspace`.
- `packages/build/src/commands/ide.test.ts` — hot-reload integration test.
- `packages/ide/src/workflow/workflow-node.tsx` — replace `hasNodeBreakpoint` field with `nodeBreakpoint`, render two dots.
- `packages/ide/src/workflow/workflow-node.test.tsx` — update dot tests for the new shape.
- `packages/ide/src/workflow/workflow-editor.tsx` — derive `nodeBreakpoint` object instead of `hasNodeBreakpoint` boolean.
- `packages/ide/src/workflow/workflow-editor.test.tsx` — update existing assertion for new shape.

**Created:** none.

---

## Task 1: Workflow-path alignment — `loadWorkspace.relativePath` workspace-root-relative (TDD)

**Files:**
- Modify: `packages/runtime/src/dev-server/load.test.ts`
- Modify: `packages/runtime/src/dev-server/load.ts`
- Modify: `packages/runtime/src/dev-server/debug-session.test.ts`

- [ ] **Step 1: Update the existing `load.test.ts` assertion (failing form)**

In `packages/runtime/src/dev-server/load.test.ts`, change the assertion in the existing test `"finds .workflow files in workflows/"` (around line 35) from:

```ts
expect(ws.workflows[0]?.relativePath).toBe("users/create.workflow");
```

to:

```ts
expect(ws.workflows[0]?.relativePath).toBe("workflows/users/create.workflow");
```

- [ ] **Step 2: Add a new test in `load.test.ts` asserting the new shape across nested dirs**

Append inside the existing `describe("loadWorkspace", ...)` block, after the last `it`:

```ts
it("relativePath is workspace-root-relative (includes 'workflows/' prefix) for nested dirs", async () => {
  mkdirSync(join(dir, "workflows", "billing", "subscriptions"), { recursive: true });
  writeFileSync(
    join(dir, "workflows", "billing", "subscriptions", "cancel.workflow"),
    JSON.stringify({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { path: "/cancel", method: "POST" } },
        res: { uses: "@core/response", in: { body: "req.body" } },
      },
    }),
  );
  const ws = await loadWorkspace(dir);
  expect(ws.workflows[0]?.relativePath).toBe("workflows/billing/subscriptions/cancel.workflow");
});
```

- [ ] **Step 3: Add a regression-guard test in `debug-session.test.ts`**

This test catches the actual bug — an IDE-format breakpoint paired with a real `loadWorkspace` relativePath. Without the fix the breakpoint wouldn't fire; with the fix it does.

Imports at the top of `packages/runtime/src/dev-server/debug-session.test.ts` need to include `mkdirSync, mkdtempSync, rmSync, writeFileSync` from `node:fs`, `tmpdir` from `node:os`, and `loadWorkspace` from `./load.js`. Add them if not present.

Append a new top-level `describe` block at the end of the file:

```ts
describe("DebugSession + loadWorkspace integration", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lorien-ds-load-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("workflowPath set by IDE matches relativePath from loadWorkspace (after breakpoint fires)", async () => {
    mkdirSync(join(dir, "workflows", "user"), { recursive: true });
    writeFileSync(
      join(dir, "workflows", "user", "create.workflow"),
      JSON.stringify({
        lorien: 1,
        nodes: {
          req: { uses: "@core/http-request", values: { path: "/users", method: "POST" } },
          save: { uses: "./fake-save" },
          res: { uses: "@core/response", in: { body: "save.x" } },
        },
      }),
    );

    const ws = await loadWorkspace(dir);
    const wf = ws.workflows[0]!;

    // The IDE stores breakpoints using workspace-root-relative paths.
    const ideStyleWorkflowPath = "workflows/user/create.workflow";

    // The fix is precisely that these two values match.
    expect(wf.relativePath).toBe(ideStyleWorkflowPath);

    // Belt-and-suspenders: confirm the lookup the runtime does actually finds
    // the IDE-stored breakpoint. We use applyBreakpoints via the WS hello
    // message (the public surface).
    const session = new DebugSession();
    const fakeWs = {} as never; // applyBreakpoints does not touch the ws
    await session.onMessage(fakeWs, {
      type: "hello",
      breakpoints: [
        { workflowPath: ideStyleWorkflowPath, nodeId: "save", kind: "after" },
      ],
    });
    expect(session.getBreakpoints(wf.relativePath)).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run the tests and confirm they fail for the expected reasons**

Run: `pnpm --filter @darrylondil/lorien-runtime test -- load.test`
Expected: FAIL — old assertion still says `"users/create.workflow"`; new tests expect prefixed form.

Run: `pnpm --filter @darrylondil/lorien-runtime test -- debug-session.test`
Expected: FAIL on the new test — `wf.relativePath` is `"user/create.workflow"`, not `"workflows/user/create.workflow"`; the `getBreakpoints(wf.relativePath)` length check returns 0.

- [ ] **Step 5: Fix `load.ts`**

In `packages/runtime/src/dev-server/load.ts:33`, change:

```ts
relativePath: relative(workflowsDir, abs).replaceAll("\\", "/"),
```

to:

```ts
relativePath: relative(root, abs).replaceAll("\\", "/"),
```

- [ ] **Step 6: Run the tests again**

Run: `pnpm --filter @darrylondil/lorien-runtime test`
Expected: ALL pass — the `load.test.ts` assertions match, the `debug-session.test.ts` regression-guard passes, AND the unchanged `debug-e2e.test.ts` continues to pass (it constructs `LoadedWorkflow` inline with prefixed paths already).

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/dev-server/load.ts \
        packages/runtime/src/dev-server/load.test.ts \
        packages/runtime/src/dev-server/debug-session.test.ts
git commit -m "fix(runtime): loadWorkspace.relativePath is workspace-root-relative"
```

---

## Task 2: Adjust `run-build.ts` codegen output to match new relativePath

**Files:**
- Modify: `packages/build/src/build/run-build.ts`

After Task 1, `wf.relativePath` includes the `workflows/` prefix. Codegen currently builds output paths via `wf.relativePath.replace(/\.workflow$/, "")` (line 61) then `join(outDir, "workflows", slugifiedPath)` (line 66). With the new prefix that would double up: `<outDir>/workflows/workflows/...`.

The fix strips the leading `workflows/` from basePath before composing the output path. The existing `run-build.test.ts` asserts output paths (`workflows/hello.gen.ts`) — those assertions must remain unchanged after this task.

- [ ] **Step 1: Run the existing run-build tests to confirm they pass before the change (sanity)**

Run: `pnpm --filter @darrylondil/lorien-build test -- run-build.test`
Expected: PASS at this point — Task 1 didn't touch run-build behavior because load.ts produced `"hello.workflow"` before; the existing test fixture's workflow lives at `<fixture>/workflows/hello.workflow`, so after Task 1 it becomes `"workflows/hello.workflow"`.

Wait — actually Task 1 broke run-build's path semantics. Run the test and observe: outputs will now go to `<outDir>/workflows/workflows/hello.gen.ts`, the assertion `existsSync(join(tmp, "workflows", "hello.gen.ts"))` fails.

Expected (with the bug introduced by Task 1): FAIL. This step exists to surface the failure that motivates the fix.

- [ ] **Step 2: Update `packages/build/src/build/run-build.ts`**

Find the codegen loop (around lines 48-71). Replace lines 60-66 — specifically these three lines:

```ts
    // Strip ".workflow" extension to get the base path
    const basePath = wf.relativePath.replace(/\.workflow$/, "")
    const { source } = emitWorkflow({ workflow: wf.file, relativePath: basePath })

    // Slugify directory segments for the output path: [id] -> _id_
    const slugifiedPath = slugifyPath(basePath)
    const outPath = join(outDir, "workflows", `${slugifiedPath}.gen.ts`)
```

with:

```ts
    // Strip ".workflow" extension and the leading "workflows/" prefix (relativePath
    // is workspace-root-relative; codegen output is rooted at <outDir>/workflows/).
    const basePath = wf.relativePath
      .replace(/^workflows\//, "")
      .replace(/\.workflow$/, "")
    const { source } = emitWorkflow({ workflow: wf.file, relativePath: basePath })

    // Slugify directory segments for the output path: [id] -> _id_
    const slugifiedPath = slugifyPath(basePath)
    const outPath = join(outDir, "workflows", `${slugifiedPath}.gen.ts`)
```

`successfulPaths.push(basePath)` (line 70) and the index emit (`emitIndex({ workflowPaths: successfulPaths })`) consume `basePath` already-stripped — that's the form codegen needs, no further changes.

- [ ] **Step 3: Re-run the tests**

Run: `pnpm --filter @darrylondil/lorien-build test`
Expected: ALL pass. Output paths return to `<outDir>/workflows/hello.gen.ts`.

Run: `pnpm --filter @darrylondil/lorien-runtime test`
Expected: ALL pass (sanity check that Task 1 didn't regress).

- [ ] **Step 4: Commit**

```bash
git add packages/build/src/build/run-build.ts
git commit -m "fix(build): strip workflows/ prefix from basePath to match new relativePath"
```

---

## Task 3: Before/After breakpoint indicator (visual)

**Files:**
- Modify: `packages/ide/src/workflow/workflow-node.tsx`
- Modify: `packages/ide/src/workflow/workflow-node.test.tsx`
- Modify: `packages/ide/src/workflow/workflow-editor.tsx`
- Modify: `packages/ide/src/workflow/workflow-editor.test.tsx`

- [ ] **Step 1: Update the failing render tests in `workflow-node.test.tsx`**

In `packages/ide/src/workflow/workflow-node.test.tsx`, find the `describe("breakpoint dots", ...)` block (around line 549). Replace its three node-level tests:

```ts
    it("renders a red dot on the header when data.hasNodeBreakpoint is true", () => {
      const { container } = render(<WorkflowNode data={{ ...baseData(), hasNodeBreakpoint: true }} />)
      expect(container.querySelector('[data-testid="node-breakpoint-dot"]')).toBeTruthy()
    })

    it("does NOT render a breakpoint dot when data.hasNodeBreakpoint is falsy", () => {
      const { container } = render(<WorkflowNode data={baseData()} />)
      expect(container.querySelector('[data-testid="node-breakpoint-dot"]')).toBeFalsy()
    })
```

with:

```ts
    it("renders a left-side dot when nodeBreakpoint.before is true", () => {
      const { container } = render(
        <WorkflowNode data={{ ...baseData(), nodeBreakpoint: { before: true, after: false } }} />,
      )
      expect(container.querySelector('[data-testid="node-breakpoint-dot-before"]')).toBeTruthy()
      expect(container.querySelector('[data-testid="node-breakpoint-dot-after"]')).toBeFalsy()
    })

    it("renders a right-side dot when nodeBreakpoint.after is true", () => {
      const { container } = render(
        <WorkflowNode data={{ ...baseData(), nodeBreakpoint: { before: false, after: true } }} />,
      )
      expect(container.querySelector('[data-testid="node-breakpoint-dot-before"]')).toBeFalsy()
      expect(container.querySelector('[data-testid="node-breakpoint-dot-after"]')).toBeTruthy()
    })

    it("renders both dots when both kinds are set", () => {
      const { container } = render(
        <WorkflowNode data={{ ...baseData(), nodeBreakpoint: { before: true, after: true } }} />,
      )
      expect(container.querySelector('[data-testid="node-breakpoint-dot-before"]')).toBeTruthy()
      expect(container.querySelector('[data-testid="node-breakpoint-dot-after"]')).toBeTruthy()
    })

    it("does NOT render any breakpoint dot when nodeBreakpoint is absent", () => {
      const { container } = render(<WorkflowNode data={baseData()} />)
      expect(container.querySelector('[data-testid="node-breakpoint-dot-before"]')).toBeFalsy()
      expect(container.querySelector('[data-testid="node-breakpoint-dot-after"]')).toBeFalsy()
    })
```

- [ ] **Step 2: Update the workflow-editor test assertion**

In `packages/ide/src/workflow/workflow-editor.test.tsx`, find the test `"breakpoints effect sets hasNodeBreakpoint on the matching RFNode"` (line 1612). Replace the test (subject + body) with:

```ts
    it("breakpoints effect sets nodeBreakpoint.before / .after on the matching RFNode", async () => {
```

…and change the assertion at line 1630:

```ts
        expect(saveNode?.data.hasNodeBreakpoint).toBe(true)
```

to:

```ts
        expect((saveNode?.data as { nodeBreakpoint?: { before: boolean; after: boolean } }).nodeBreakpoint).toEqual({
          before: true,
          after: false,
        })
```

(The existing test sets up only a `before` breakpoint — read the test's surrounding context around line 1612-1629 to confirm; if it sets an `after` breakpoint instead, flip the booleans accordingly.)

- [ ] **Step 3: Run the tests and verify they fail for the expected reasons**

Run: `pnpm --filter @darrylondil/lorien-ide test -- workflow-node.test workflow-editor.test`
Expected: FAIL — `nodeBreakpoint` field doesn't exist on `WorkflowNodeData`; render selectors `[data-testid="node-breakpoint-dot-before"]` and `[data-testid="node-breakpoint-dot-after"]` don't match anything.

- [ ] **Step 4: Update `workflow-node.tsx`**

In `packages/ide/src/workflow/workflow-node.tsx`:

(a) At lines 44-49 — replace the `hasNodeBreakpoint?: boolean` field declaration on `WorkflowNodeData` (around lines 45-49):

```ts
  /**
   * When true, renders a red dot on the node header to indicate a node-level
   * breakpoint ("before" or "after") is set for this node.
   */
  hasNodeBreakpoint?: boolean;
```

with:

```ts
  /**
   * Node-level breakpoints. Each side is rendered as a red dot on the
   * corresponding edge of the node header. Both can be true.
   */
  nodeBreakpoint?: { before: boolean; after: boolean };
```

(b) At line 96 (the destructuring inside the component function), replace:

```ts
    hasNodeBreakpoint,
```

with:

```ts
    nodeBreakpoint,
```

(c) Replace the dot-render block at lines 176-182:

```ts
        {hasNodeBreakpoint && (
          <span
            data-testid="node-breakpoint-dot"
            className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-600"
            aria-label="breakpoint"
          />
        )}
```

with:

```ts
        {nodeBreakpoint?.before && (
          <span
            data-testid="node-breakpoint-dot-before"
            className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-red-600"
            aria-label="before-breakpoint"
          />
        )}
        {nodeBreakpoint?.after && (
          <span
            data-testid="node-breakpoint-dot-after"
            className="absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-red-600"
            aria-label="after-breakpoint"
          />
        )}
```

(Left dot anchors to `-left-1`, right dot to `-right-1`; both vertical-center via `top-1/2 -translate-y-1/2`. Tailwind class conventions match the rest of the file.)

- [ ] **Step 5: Update `workflow-editor.tsx`**

In `packages/ide/src/workflow/workflow-editor.tsx`, find the `useEffect` block around line 556-576. Replace lines 562-572 — specifically:

```ts
        const hasNodeBreakpoint = bps.some(
          (b) => b.kind === "before" || b.kind === "after",
        );
        const portBreakpoints = new Set(
          bps
            .filter((b) => b.kind.startsWith("port:"))
            .map((b) => b.kind.slice("port:".length)),
        );
        return {
          ...n,
          data: { ...n.data, hasNodeBreakpoint, portBreakpoints },
        };
```

with:

```ts
        const nodeBreakpoint = {
          before: bps.some((b) => b.kind === "before"),
          after: bps.some((b) => b.kind === "after"),
        };
        const portBreakpoints = new Set(
          bps
            .filter((b) => b.kind.startsWith("port:"))
            .map((b) => b.kind.slice("port:".length)),
        );
        return {
          ...n,
          data: { ...n.data, nodeBreakpoint, portBreakpoints },
        };
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @darrylondil/lorien-ide test`
Expected: ALL pass. The five new node-render tests pass; the renamed workflow-editor test passes.

- [ ] **Step 7: Commit**

```bash
git add packages/ide/src/workflow/workflow-node.tsx \
        packages/ide/src/workflow/workflow-node.test.tsx \
        packages/ide/src/workflow/workflow-editor.tsx \
        packages/ide/src/workflow/workflow-editor.test.tsx
git commit -m "feat(ide): left/right positional dots for before/after breakpoints"
```

---

## Task 4: Refactor — extract `buildAppForWorkspace` and install dispatcher indirection

Pure refactor for Task 6 to build on. No behavior change.

**Files:**
- Modify: `packages/build/src/commands/ide.ts`

- [ ] **Step 1: Find the relevant block in `ide.ts`**

In `packages/build/src/commands/ide.ts`, locate the section inside `runIde` that goes from `const app = createIdeApp(workspaceRoot)` through `mountWorkflows(app, loadedWorkflows, { ... })`. This is the inline app construction.

The current shape (paraphrased — the actual file has comments and intermediate code):

```ts
  const app = createIdeApp(workspaceRoot)
  // (chokidar watcher for tree-SSE setup is around here — leave it ALONE)
  // (debug-session creation + console-capture + makeDebugIntegration call here — leave it ALONE)
  mountWorkflows(app, loadedWorkflows, {
    nodes: loadedNodes,
    services: loadedServices,
    debug,
  })
  // ...later...
  return new Promise((resolveStarted) => {
    const server = serve({ fetch: app.fetch, port: availablePort }, ({ port: actualPort }) => { ... })
    attachDebugWebSocket({ app, server, session: debugSession })
    // ...
  })
```

- [ ] **Step 2: Introduce `buildAppForWorkspace` helper**

Add a new top-level function inside `packages/build/src/commands/ide.ts` (above `runIde`, near other helpers):

```ts
/**
 * Assembles the Hono app for a workspace snapshot. Called once at startup and
 * again on every workflow hot-reload. Returns a fresh `Hono` with IDE API
 * routes + workflow handlers mounted; static SPA serving is added by the caller
 * because it doesn't change across reloads.
 */
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

Required imports (most are already present; verify and add any missing):
- `Hono` from `"hono"` (already present)
- `LoadedWorkflow` from `"@darrylondil/lorien-runtime"` (verify — it may be exported; if not, import from where `loadWorkspace` is imported)
- `AnyNodeOrTrigger` from `"@darrylondil/lorien-runtime"` (already present per earlier code reads)
- `Services` from `"@darrylondil/lorien-runtime"` (already present)
- `DebugIntegration` from `"@darrylondil/lorien-runtime"` (already present)

If `LoadedWorkflow` isn't exported from the runtime package, fall back to importing the type from where `loadWorkspace` lives, or define a small local alias `type LoadedWorkflow = Awaited<ReturnType<typeof loadWorkspace>>["workflows"][number]`.

- [ ] **Step 3: Replace the inline mount with a `buildAppForWorkspace` call**

In `runIde`, locate the lines that today do `const app = createIdeApp(...)` + `mountWorkflows(app, ...)`. Replace them with:

```ts
  let currentApp: Hono = buildAppForWorkspace({
    workspaceRoot,
    loadedWorkflows,
    loadedNodes,
    loadedServices,
    debug,
  })

  // Static SPA + index fallback are added directly to currentApp here.
  // (Move the existing static-serve middleware lines here so they're applied to
  // the initial app; on reload we'll re-apply them to the new app — see Task 6.)
```

If the static SPA mounting (`app.use("/*", serveStatic({...}))` and `app.get("*", serveStatic({...}))`) is currently AFTER `mountWorkflows`, leave it for now — Task 6 will move it into `buildAppForWorkspace` so it survives reloads.

For Task 4's scope, we ONLY introduce the helper + variable. Behavior unchanged.

- [ ] **Step 4: Add dispatcher indirection at the `serve` callsite**

Find the line `const server = serve({ fetch: app.fetch, port: availablePort }, ...)` (the variable is `app`, soon-to-be `currentApp`). Replace with:

```ts
    const dispatcher: typeof currentApp.fetch = (req, env, ctx) =>
      currentApp.fetch(req, env, ctx)
    const server = serve({ fetch: dispatcher, port: availablePort }, ({ port: actualPort }) => {
      // existing body unchanged
    })
```

The dispatcher closes over the mutable `currentApp` from Step 3. Hot-reload (Task 6) will reassign `currentApp` and existing connections will hit the new app on their next request.

The `attachDebugWebSocket({ app: currentApp, server, session: debugSession })` call below: change `app: currentApp` (or just `app: dispatcher as never` — actually, the cleanest thing is to pass the initial `currentApp` value because the function ignores the arg anyway, per the spec's confirmed finding §7).

```ts
    attachDebugWebSocket({ app: currentApp, server, session: debugSession })
```

- [ ] **Step 5: Run tests + manual sanity**

Run: `pnpm --filter @darrylondil/lorien-build test`
Expected: ALL pass. The refactor doesn't change behavior; existing IDE tests must still pass.

Quick smoke: build runtime + build, then run `node packages/build/dist/cli.js ide --no-open --root examples/basic-api --port 3737` and confirm:
- Startup line `lorien IDE running at http://localhost:3737`
- `curl http://localhost:3737/api/workspace/info` returns a JSON object with `root` set
- `curl -X POST http://localhost:3737/users -H "content-type: application/json" -d '{"email":"a@b.com","password":"hunter22"}'` returns the expected response (or the expected 500 — whatever it returned before this task)

Stop the IDE process.

- [ ] **Step 6: Commit**

```bash
git add packages/build/src/commands/ide.ts
git commit -m "refactor(build): extract buildAppForWorkspace + dispatcher indirection"
```

---

## Task 5: `DebugSession.abortAllRuns()` (TDD)

**Files:**
- Modify: `packages/runtime/src/dev-server/debug-session.test.ts`
- Modify: `packages/runtime/src/dev-server/debug-session.ts`

- [ ] **Step 1: Write the failing test**

In `packages/runtime/src/dev-server/debug-session.test.ts`, append a new top-level `describe` block at the end of the file:

```ts
describe("DebugSession.abortAllRuns", () => {
  it("rejects the pause promise for each paused run with an AbortError and clears the runs map", async () => {
    const s = new DebugSession();

    // Register two runs and seed an active pause on each via the test seam.
    s.registerRun("wf", "rA", Date.now());
    s.registerRun("wf", "rB", Date.now());

    const rejections: unknown[] = [];
    const pauseA = new Promise<void>((resolve, reject) => {
      s._setActivePauseForTest("rA", {
        resolve,
        reject: (err: unknown) => {
          rejections.push(err);
          reject(err);
        },
        frame: { runId: "rA", nodeId: "n1", phase: "before" },
      });
    });
    const pauseB = new Promise<void>((resolve, reject) => {
      s._setActivePauseForTest("rB", {
        resolve,
        reject: (err: unknown) => {
          rejections.push(err);
          reject(err);
        },
        frame: { runId: "rB", nodeId: "n1", phase: "before" },
      });
    });

    s.abortAllRuns();

    // Both pauses rejected; both runs removed.
    expect(rejections).toHaveLength(2);
    for (const err of rejections) {
      expect((err as Error).name).toBe("AbortError");
      expect((err as Error).message).toMatch(/workflow reloaded/i);
    }
    await expect(pauseA).rejects.toThrow();
    await expect(pauseB).rejects.toThrow();
    expect(s.getRunStartedAt("rA")).toBeNull();
    expect(s.getRunStartedAt("rB")).toBeNull();
  });

  it("is safe to call when there are no runs", () => {
    const s = new DebugSession();
    expect(() => s.abortAllRuns()).not.toThrow();
  });

  it("removes runs that are not paused too (in-flight without active pause)", () => {
    const s = new DebugSession();
    s.registerRun("wf", "r1", Date.now());
    // No active pause seeded.
    s.abortAllRuns();
    expect(s.getRunStartedAt("r1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @darrylondil/lorien-runtime test -- debug-session.test`
Expected: FAIL — `s.abortAllRuns is not a function`.

- [ ] **Step 3: Add `abortAllRuns` to `DebugSession`**

In `packages/runtime/src/dev-server/debug-session.ts`, find the existing `unregisterRun` method (around lines 148-154). Add a new public method directly after it:

```ts
  /**
   * Used by the IDE command's hot-reload pipeline: when a `.workflow` file
   * changes, all current runs are invalidated. Reject any paused pause-promise
   * with AbortError so the handler's catch block can broadcast run-error via
   * the normal `opts.debug?.onError` path; then remove the run from the map.
   *
   * Does NOT broadcast run-error itself — that's the handler's responsibility
   * and would otherwise double up.
   */
  abortAllRuns(): void {
    for (const runId of [...this.runs.keys()]) {
      const state = this.runs.get(runId)
      if (state?.pause) {
        state.pause.reject(new AbortError("run aborted: workflow reloaded"))
        state.pause = null
      }
      this.runs.delete(runId)
    }
  }
```

`AbortError` is already declared in this file at lines 27-29 — no new import needed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @darrylondil/lorien-runtime test -- debug-session.test`
Expected: PASS — all three new tests pass; existing tests still pass.

- [ ] **Step 5: Run full runtime test suite**

Run: `pnpm --filter @darrylondil/lorien-runtime test`
Expected: ALL pass.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/dev-server/debug-session.ts \
        packages/runtime/src/dev-server/debug-session.test.ts
git commit -m "feat(runtime): DebugSession.abortAllRuns for hot-reload pipeline"
```

---

## Task 6: Workflow hot-reload — watcher + reloadWorkspace (with integration test)

**Files:**
- Modify: `packages/build/src/commands/ide.ts`
- Modify: `packages/build/src/commands/ide.test.ts`

- [ ] **Step 1: Write the failing integration test**

In `packages/build/src/commands/ide.test.ts`, append a new top-level `describe` block at the end of the file:

```ts
import { writeFileSync, mkdirSync as mkdirSyncFs } from "node:fs"
import { join as joinPath } from "node:path"

describe("ide command — workflow hot-reload", () => {
  let dir: string
  let portUsed: number
  let stopServer: (() => Promise<void>) | null = null

  beforeEach(() => {
    dir = mkdtempSync(joinPath(tmpdir(), "lorien-ide-hr-"))
    mkdirSyncFs(joinPath(dir, "workflows"), { recursive: true })
  })

  afterEach(async () => {
    if (stopServer) {
      await stopServer()
      stopServer = null
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it("reloads the workspace when a .workflow file is rewritten", async () => {
    // Initial workflow: GET /ping returns "v1".
    writeFileSync(
      joinPath(dir, "workflows", "ping.workflow"),
      JSON.stringify({
        lorien: 1,
        nodes: {
          req: { uses: "@core/http-request", values: { path: "/ping", method: "GET" } },
          res: { uses: "@core/response", values: { body: "v1" } },
        },
      }),
    )

    const { runIde } = await import("./ide.js")
    // parseStartingPort rejects port: 0; use a randomized high port.
    // findAvailablePort scans upward from this if it's busy, so collisions are tolerated.
    const startPort = 40000 + Math.floor(Math.random() * 10000)
    const { port } = await runIde({ root: dir, port: startPort, open: false })
    portUsed = port
    stopServer = async () => {
      // No-op: runIde does not currently expose a server-shutdown handle.
      // The server keeps listening until the vitest worker exits. Acceptable
      // for now — see "Open follow-ups" at the bottom of this plan.
    }

    // Sanity: initial workflow responds with v1.
    const r1 = await fetch(`http://127.0.0.1:${port}/ping`)
    expect(await r1.text()).toBe('"v1"')

    // Overwrite the workflow on disk — response body changes to "v2".
    writeFileSync(
      joinPath(dir, "workflows", "ping.workflow"),
      JSON.stringify({
        lorien: 1,
        nodes: {
          req: { uses: "@core/http-request", values: { path: "/ping", method: "GET" } },
          res: { uses: "@core/response", values: { body: "v2" } },
        },
      }),
    )

    // chokidar + 100ms debounce ⇒ wait long enough for the reload to complete.
    await new Promise((r) => setTimeout(r, 400))

    const r2 = await fetch(`http://127.0.0.1:${port}/ping`)
    expect(await r2.text()).toBe('"v2"')
  }, 8000)
})
```

(The `stopServer` callback is a placeholder — `runIde` does not currently return a teardown handle. For now, leave it as a no-op; the `afterEach` `rmSync` removes the workspace but the http server keeps running until the vitest process exits. This is acceptable for the test because we use port `0` for OS-assigned ports.)

If the import structure of the existing `ide.test.ts` file already has `mkdtempSync`, `tmpdir`, `rmSync`, etc., reuse those imports rather than re-importing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @darrylondil/lorien-build test -- ide.test`
Expected: FAIL — second fetch still returns `"v1"` because there's no hot-reload yet.

- [ ] **Step 3: Wire the watcher + reloadWorkspace in `ide.ts`**

In `packages/build/src/commands/ide.ts`, inside `runIde` AFTER the initial `currentApp = buildAppForWorkspace(...)` call from Task 4 and BEFORE the `serve(...)` call, add:

```ts
  // Hot-reload: watch <root>/workflows/**/*.workflow. On any change, reload the
  // workspace and atomically swap currentApp so subsequent requests hit the
  // fresh workflow. Paused runs are aborted (their pause-promise rejects with
  // AbortError; the handler's catch block broadcasts run-error).
  const debounce = <F extends (...args: never[]) => void>(fn: F, ms: number): F => {
    let t: NodeJS.Timeout | null = null
    return ((...args: never[]) => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        t = null
        fn(...args)
      }, ms)
    }) as F
  }

  const reloadWorkspace = async (): Promise<void> => {
    try {
      const ws = await loadWorkspace(workspaceRoot)
      if (ws.errors.length > 0) {
        for (const e of ws.errors) console.error(`[lorien] ${e.path}: ${e.message}`)
      }
      debugSession.abortAllRuns()
      currentApp = buildAppForWorkspace({
        workspaceRoot,
        loadedWorkflows: ws.workflows,
        loadedNodes,
        loadedServices,
        debug,
      })
      console.log(`lorien IDE: reloaded ${ws.workflows.length} workflow(s)`)
    } catch (err) {
      console.error(
        `lorien IDE: reload failed — ${(err as Error).message}`,
      )
    }
  }

  const debouncedReload = debounce(reloadWorkspace, 100)

  const workflowWatcher = chokidar.watch(
    join(workspaceRoot, "workflows", "**", "*.workflow"),
    { ignoreInitial: true },
  )
  workflowWatcher.on("all", () => {
    debouncedReload()
  })
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @darrylondil/lorien-build test -- ide.test`
Expected: PASS — second fetch returns `"v2"`.

- [ ] **Step 5: Static SPA mounting check**

Verify that the `app.use("/*", serveStatic({...}))` + `app.get("*", serveStatic({...}))` lines are inside `buildAppForWorkspace` (so they're re-applied on each reload). If they're still outside (sitting in `runIde` after the initial `buildAppForWorkspace` call), MOVE them into `buildAppForWorkspace` after `mountWorkflows`. Otherwise the IDE SPA stops serving after the first hot-reload.

Concretely, `buildAppForWorkspace` should end with the static-SPA middleware applied to the new app before returning. The cleanest shape:

```ts
function buildAppForWorkspace(params: {...}): Hono {
  const app = createIdeApp(params.workspaceRoot)
  mountWorkflows(app, params.loadedWorkflows, { nodes, services, debug })
  // Static SPA — must be inside the build helper so it survives hot-reload.
  app.use("/*", serveStatic({
    root: ideDistRoot,
    rewriteRequestPath: (p) => (p === "/" ? "/index.html" : p),
  }))
  app.get("*", serveStatic({ root: ideDistRoot, path: "index.html" }))
  return app
}
```

`ideDistRoot` is currently resolved inside `runIde` via `await resolveIdeDistRoot()`. Pass it in as another param to `buildAppForWorkspace`:

```ts
function buildAppForWorkspace(params: {
  workspaceRoot: string
  ideDistRoot: string
  loadedWorkflows: LoadedWorkflow[]
  loadedNodes: Record<string, AnyNodeOrTrigger>
  loadedServices: Services
  debug: DebugIntegration
}): Hono { ... }
```

Update the two call-sites (initial in `runIde`, and `reloadWorkspace`) to pass `ideDistRoot` accordingly. Re-run tests.

- [ ] **Step 6: Run full test suites**

Run: `pnpm --filter @darrylondil/lorien-build test && pnpm --filter @darrylondil/lorien-runtime test`
Expected: ALL pass.

- [ ] **Step 7: Commit**

```bash
git add packages/build/src/commands/ide.ts \
        packages/build/src/commands/ide.test.ts
git commit -m "feat(build): hot-reload .workflow files via chokidar + app-swap"
```

---

## Task 7: Manual smoke

Verify the full feature end-to-end.

- [ ] **Step 1: Rebuild packages**

Run:

```bash
pnpm --filter @darrylondil/lorien-runtime build
pnpm --filter @darrylondil/lorien-build build
```

Expected: both succeed.

- [ ] **Step 2: Launch the IDE against basic-api**

Run (from repo root):

```bash
node packages/build/dist/cli.js ide --no-open --root examples/basic-api --port 3737
```

Expected: `lorien IDE running at http://localhost:3737`.

- [ ] **Step 3: Open the IDE and load the workflow**

Browse to `http://localhost:3737`, open `workflows/user/create.workflow`. Confirm the SaveUser node renders.

- [ ] **Step 4: Verify before/after dots**

Right-click SaveUser, set a `before` breakpoint. Confirm a red dot appears on the LEFT edge of the node header. Right-click again, also set `after`. Confirm a second red dot appears on the RIGHT edge of the header.

- [ ] **Step 5: Verify the `after` breakpoint actually fires (the original bug)**

Remove the `before` breakpoint, keep `after`. Fire `POST /users` from the Run tab. Confirm the run pauses AT THE END of `SaveUser` (the Debug panel shows the paused state with `phase: "after"` on SaveUser). Resume the run via the continue button. The run completes.

- [ ] **Step 6: Verify hot-reload**

In your text editor (or the IDE canvas), modify `examples/basic-api/workflows/user/create.workflow` — e.g., change the Response node's `status` from `200` to `201`. Save. Watch the IDE process stdout for `lorien IDE: reloaded N workflow(s)`. Fire POST /users again from the Run tab. Confirm the response status is now `201`. No process restart needed.

- [ ] **Step 7: Verify paused-run abort on reload**

Set an `after` breakpoint on SaveUser. Fire POST /users; let the run pause. While the run is paused, modify the workflow file (any change). Watch the Debug panel — the paused run should transition to `errored` with message containing "workflow reloaded" or similar.

- [ ] **Step 8: Stop the IDE**

Ctrl+C the IDE process.

- [ ] **Step 9: No commit needed**

This is a manual checklist. If any step failed, fix the underlying issue and re-test before claiming the plan complete.

---

## Final Verification

- [ ] All seven implementation commits land in sequence on the branch.
- [ ] `pnpm test` (root) passes across all packages.
- [ ] `pnpm typecheck` (root) passes.
- [ ] Manual smoke (Task 7) confirms: left/right dot positioning, `after` breakpoints fire, hot-reload works, paused runs abort cleanly.
- [ ] No leftover `console.warn` noise about `event arrived before run-started` during normal operation.

---

## Open follow-ups (not in this plan)

- `runIde` does not return a server-shutdown handle. The hot-reload test in Task 6 cannot cleanly tear down the http server it starts. Acceptable for vitest (process-scoped lifetimes) but means tests that run `runIde` accumulate listeners across the file. Future plan should add a returned `stop()` callback.
- `.ts` node files don't hot-reload — would require tsx-cache invalidation. Same for `lorien.config.ts` services.
- Surgical per-workflow re-mount (instead of broad reload) would avoid disrupting unrelated in-flight requests. Hono doesn't expose unmount, so this needs a routing-table indirection layer. Worth doing if reload latency becomes a problem.
