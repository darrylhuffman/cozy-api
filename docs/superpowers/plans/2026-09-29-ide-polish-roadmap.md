# IDE polish roadmap — tests, editor, errors, AI, shared requests, node cases

**Date:** 2026-09-29
**Base branch:** `feat/trigger-prefill` (the branch carrying the workflow editor, debugger and agent panel; `main` is 180 commits behind it)

## Where the app is today

- `.workflow` JSON graphs + `defineNode` TS nodes, interpreted in dev and compiled to Hono for prod.
- IDE (`packages/ide`): dockview shell, React Flow canvas with expandable port trees, inline literal widgets, breakpoints + live run status, Run tab (trigger-aware request builder + in-memory history), Debug panel, Monaco code tabs, Agents panel that drives the user's local `claude` CLI.
- IDE server (`lorien ide`, `packages/build/src/commands/ide.ts`): file API, schema introspection, SSE file events, debug WS, agent broker, and the workflows themselves.

## Problems found while reading the code

| Area | Problem |
|---|---|
| Data loss | One `WorkflowEditor` instance is reused across workflow tabs. Switching tabs refetches from disk and throws away unsaved edits, while the old tab keeps its "dirty" dot. Expansion state also leaks between workflows. |
| Placement | Drop, right-click "add node" and the command palette place nodes in screen pixels, ignoring pan/zoom, so nodes land in the wrong spot after panning. |
| Saving | Ctrl+S saves only from React Flow positions; a failed save shows "Save failed" with no reason and no retry. Load errors have no retry. Invalid JSON shows a raw parser error. |
| External edits | If the file changes on disk (e.g. the AI agent edits it) while the tab is dirty, the change is silently ignored; no conflict notice. |
| Leaving | No `beforeunload` guard for dirty tabs. |
| Wiring | The production IDE bundle defaults its API base to `http://localhost:3000` (the user's API server), so the Agents panel, debugger WS and Run tab point at the wrong server when served by `lorien ide`/`lorien dev` on :8188. `lorien dev --root x` also starts the IDE on the cwd instead of `x`. |
| Schemas | Editor and inspector each fetch schemas once and never refresh when node files change. |
| CI | No CI at all. Biome reports ~250 pre-existing format errors. |

## Delivery plan (incremental draft PRs, each green before the next)

1. **Editor reliability + error handling + CI**
   - Per-tab draft store; editor keyed per tab so switching never loses edits.
   - Positions written into the draft on drag end; undo/redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y).
   - `screenToFlowPosition` for drop / context menu / palette.
   - Save/load error surfaces with the server message and Retry; JSON parse errors with a readable message.
   - "Changed on disk" banner with Reload / Keep mine when a dirty tab's file changes.
   - `beforeunload` guard.
   - Same-origin API base for the served IDE; pass `--root` through `lorien dev`.
   - GitHub Actions CI: install, build, typecheck, test.
2. **Validation + editor redesign**
   - Shared schema store refreshed from file events.
   - Live validation (unknown node, dangling reference, unconnected required input, cycles) shown on nodes and in a Problems list.
   - Canvas toolbar (save state, run, validate, fit, auto-layout), minimap, toasts + dialogs replacing `window.confirm`, keyboard shortcut sheet, node card visual refresh.
3. **Shared request collections ("dev Postman")**
   - Saved requests committed to the repo (`*.requests.json` next to each workflow) so the team shares them.
   - Environments/variables, assertions (status, header, JSON path, schema), run one / run all from the Run tab.
   - `lorien test` + a Vitest helper so the same cases run in CI.
4. **Node test cases**
   - `*.cases.json` next to a node: input (+ config/service mocks) → expected output or error.
   - Tests tab lists and runs node + workflow cases through the IDE server; pass/fail badges on canvas nodes; "save last run as a case".
5. **AI integration**
   - Context-aware agent actions: explain node, generate node cases, generate request cases, fix a failed run (error + trace attached), create node from description.
   - Context chips on chat messages (workflow, selected node, last run), skill doc updated for cases/requests.
