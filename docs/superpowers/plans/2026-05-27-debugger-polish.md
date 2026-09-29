# Debugger Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply three mechanical follow-ups from the HTTP refactor's final review — move `wsSender` into the Zustand store, replace array-index keys in `LogsView`, rename an unused `totalMs` parameter. No user-visible behavior changes.

**Architecture:** Single commit covering three independent files. One added test confirms `getInitialState` includes `wsSender: null`.

**Tech Stack:** TypeScript, Zustand, React, Vitest.

**Working dir:** `C:\Users\hello\source\cozy-api`. Branch: `feat/trigger-prefill` (continuation) OR a fresh branch. Spec: `docs/superpowers/specs/2026-05-27-debugger-polish-design.md`.

**`.tsbuildinfo` reminder:** `rm -f packages/ide/tsconfig.app.tsbuildinfo packages/ide/tsconfig.node.tsbuildinfo` before typechecking.

---

## File map

**Modify:**
- `packages/ide/src/store/debug-session.ts` — `wsSender` becomes a state field
- `packages/ide/src/store/debug-session.test.ts` — add one test for initial state
- `packages/ide/src/panels/debug-panel/logs-view.tsx` — stable composite key
- `packages/build/src/commands/debug-integration.ts` — `totalMs` → `_totalMs` rename

---

## Task 1: Apply the three polish items

**Files:**
- Modify: `packages/ide/src/store/debug-session.ts`
- Modify: `packages/ide/src/store/debug-session.test.ts`
- Modify: `packages/ide/src/panels/debug-panel/logs-view.tsx`
- Modify: `packages/build/src/commands/debug-integration.ts`

### Step 1: Write the new initial-state test

Append to `packages/ide/src/store/debug-session.test.ts`:

```ts
it("getInitialState returns wsSender: null", () => {
  const init = useDebugSessionStore.getState().getInitialState()
  expect(init.wsSender).toBeNull()
})
```

### Step 2: Verify FAIL

```bash
rm -f packages/ide/tsconfig.app.tsbuildinfo packages/ide/tsconfig.node.tsbuildinfo
pnpm --filter @darrylondil/lorien-ide test debug-session -- --run 2>&1 | tail -10
```

Expected: FAIL — `getInitialState()` doesn't return `wsSender` yet (it's a module-level `let`).

### Step 3: Move `wsSender` into Zustand state

In `packages/ide/src/store/debug-session.ts`:

(a) Add `wsSender` to the `DebugSessionState` interface near the other state fields (around line 70, alongside `connected`, `runs`, etc.):

```ts
wsSender: ((msg: ClientMessage) => void) | null
```

(b) Update the `getInitialState` return-type Pick to include `wsSender`:

```ts
getInitialState: () => Pick<
  DebugSessionState,
  "connected" | "runs" | "selectedRunId" | "breakpoints" | "requestForm" | "wsSender"
>
```

(c) In `initialData` (around line 110-116) add the field:

```ts
const initialData = {
  connected: false,
  runs: [] as RunRecord[],
  selectedRunId: null as string | null,
  breakpoints: [] as Breakpoint[],
  requestForm: initialRequestForm,
  wsSender: null as DebugSessionState["wsSender"],
}
```

(d) DELETE the module-level `let wsSender: ((msg: ClientMessage) => void) | null = null` line (around line 118).

(e) Update `setWsSender` to write to state instead of the module variable:

```ts
setWsSender: (send) => set({ wsSender: send }),
```

(f) Update the four step actions (around line 294-297) to read from state via `get()`:

```ts
sendContinue: (runId) => get().wsSender?.({ type: "continue", runId }),
sendStep: (runId) => get().wsSender?.({ type: "step", runId }),
sendStepOver: (runId) => get().wsSender?.({ type: "step-over", runId }),
sendStop: (runId) => get().wsSender?.({ type: "stop", runId }),
```

### Step 4: Apply the LogsView key fix

In `packages/ide/src/panels/debug-panel/logs-view.tsx`, find around lines 69-71:

```tsx
{filtered.map((row, i) => (
  <LogRow key={i} row={row} />
))}
```

Replace with:

```tsx
{filtered.map((row) => (
  <LogRow
    key={`${row.offsetMs}-${row.level}-${row.message.slice(0, 40)}`}
    row={row}
  />
))}
```

The `(row, i)` second arg is no longer needed; clean it up.

### Step 5: Rename `totalMs` to `_totalMs` in debug-integration.ts

In `packages/build/src/commands/debug-integration.ts`, the `onError` callback currently (around line 72-88):

```ts
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
```

Rename the third parameter to `_totalMs` and delete the `void totalMs` line:

```ts
onError: (runId, err, _totalMs) => {
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
},
```

### Step 6: Verify PASS

```bash
rm -f packages/ide/tsconfig.app.tsbuildinfo packages/ide/tsconfig.node.tsbuildinfo
pnpm --filter @darrylondil/lorien-ide test debug-session -- --run 2>&1 | tail -10
pnpm --filter @darrylondil/lorien-ide test 2>&1 | tail -10
pnpm -r typecheck 2>&1 | tail -10
pnpm -r build 2>&1 | tail -10
```

Expected: all green across all packages.

### Step 7: Commit

```bash
git add packages/ide/src/store/debug-session.ts packages/ide/src/store/debug-session.test.ts packages/ide/src/panels/debug-panel/logs-view.tsx packages/build/src/commands/debug-integration.ts
git commit -m "chore(ide): debugger polish (wsSender in store, LogsView keys, ide.ts param naming)

Three follow-ups from the HTTP refactor's final code review:

1. wsSender moves from module-level mutable state into the Zustand
   store. setWsSender writes via set(); sendContinue/Step/StepOver/
   Stop read via get(). Avoids cross-instance contamination in tests.

2. LogsView replaces the array-index React key with a stable composite
   key (offsetMs + level + message.slice(0, 40)). Prevents reconciler
   confusion when filter narrows the visible rows.

3. debug-integration.ts onError renames the unused totalMs parameter
   to _totalMs and drops the void totalMs line. Pure rename; cleaner
   idiom.

No user-visible behavior changes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Final verification

After the commit, the full project gate should be clean:

```bash
find . -name "*.tsbuildinfo" -delete
pnpm -r test 2>&1 | tail -20
pnpm -r typecheck 2>&1 | tail -10
pnpm -r build 2>&1 | tail -10
```

All green = done.
