# Debugger polish (3 items) — design

**Date:** 2026-05-27
**Subsystem:** debugger (subsystem #7) — follow-up polish
**Status:** brainstorm complete, ready for implementation planning
**Predecessor specs:** `docs/superpowers/specs/2026-05-26-debugger-http-refactor-design.md`

---

## 1. Goal

Three mechanical follow-up items flagged in the HTTP refactor's final code review. All non-blocking polish; no behavior changes for end users; tightens test isolation and code clarity.

### In scope

1. Move `wsSender` from module-level mutable state into the Zustand store's state shape
2. Replace array-index React keys in `LogsView` with stable composite keys
3. Rename unused `totalMs` parameter in `ide.ts` `onError` to `_totalMs` (drop the `void` idiom)

### Deferred

- Port auto-expand (< 10 attributes) — user-deferred during brainstorming

---

## 2. wsSender → Zustand state

**Current:** `packages/ide/src/store/debug-session.ts` has `let wsSender: ((msg: ClientMessage) => void) | null = null` at module scope. The four step-action methods (`sendContinue`, `sendStep`, `sendStepOver`, `sendStop`) read this closure variable. `setWsSender(send)` writes it.

**Problem:** Module-level mutable state is shared across all store instances. In a real app there's only one store, so this is harmless in production — but tests that render `useDebugTransport` concurrently (or HMR scenarios) can cross-contaminate the sender. The reviewer's final-review note called it "a fragile seam for future tests."

**Change:** Add `wsSender` to the `DebugSessionState` interface; move the field into `initialData` (as `null`); `setWsSender` writes via `set({ wsSender: send })`; the four step actions read via `get().wsSender?.(msg)`.

`getInitialState()` returns `wsSender: null` so test resets clear it. One added test confirms the reset.

## 3. LogsView stable React key

**Current:** `packages/ide/src/panels/debug-panel/logs-view.tsx` renders `filtered.map((row, i) => <LogRow key={i} row={row} />)`. Array index keys cause React reconciliation hiccups when rows are filtered or new logs are prepended (in our case logs are appended, not prepended, but the filter operation reorders within the visible window).

**Change:** Use a stable composite key:

```tsx
<LogRow
  key={`${row.offsetMs}-${row.level}-${row.message.slice(0, 40)}`}
  row={row}
/>
```

Deterministic, cheap (the slice is bounded), stable across renders. Two log rows with identical offsetMs + level + first 40 chars are essentially the same log line — collision is rare and the worst case is one row failing to animate. Fine for non-virtualized rendering of < 1000 entries.

## 4. ide.ts onError parameter rename

**Current:** `packages/build/src/commands/ide.ts`'s `DebugIntegration.onError` is `(runId, err, totalMs) => { ... ; void totalMs }`. The `void totalMs` silences the unused-parameter lint.

**Change:** Rename the destructured parameter from `totalMs` to `_totalMs` (TypeScript / lint convention for "intentionally unused"). Delete the `void totalMs` line. Pure rename; no behavior change.

---

## 5. Testing

- Add to `packages/ide/src/store/debug-session.test.ts`:
  ```ts
  it("getInitialState returns wsSender: null", () => {
    const init = useDebugSessionStore.getState().getInitialState()
    expect(init.wsSender).toBeNull()
  })
  ```
- Existing tests that exercise `setWsSender` + `sendContinue` should pass unchanged (the action signature is identical).
- No new tests for LogsView or ide.ts changes (no behavior change).

## 6. Acceptance

- `pnpm -r test` green
- `pnpm -r typecheck` clean
- Single commit, message:
  ```
  chore(ide): debugger polish (wsSender in store, LogsView keys, ide.ts param naming)
  ```

## 7. Out-of-scope

- Port auto-expand on < 10 attributes
- Larger refactors to step-action plumbing (e.g., async or batching)
- Virtualized LogsView for very long log streams
