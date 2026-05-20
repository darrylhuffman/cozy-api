# `@lorien/ide` shell — design

**Date:** 2026-05-20
**Builds on:** `2026-05-20-lorien-api-design.md` §7.1 (Layout B), §7.4 (creation flow)
**Scope:** Sub-project #3 — the IDE shell. Frontend SPA only; backend bridge comes in a later sub-project.
**Status:** design approved, ready for plan-writing

---

## What's in this sub-project

A Vite + React + TypeScript SPA at `packages/ide/` that:

1. Renders **Layout B**: three docked panels (left navigation, center editor area, right inspector)
2. Supports **movable/resizable docked panes** (the "IDE-like windows can be moved around" requirement from the original brief)
3. Shows a **file tree** in the left panel (mock data — backend wiring is later sub-projects)
4. Shows a **tab strip** in the center panel; clicking a file in the tree opens a tab
5. Shows an **inspector** in the right panel with three tabs (Inspect / Tests / Run)
6. **Persists layout** to localStorage — refresh keeps your panel arrangement
7. Uses **shadcn/ui** for buttons, inputs, tabs, etc.; Tailwind v4 for styling
8. Is **served by `lorien ide`** — `@lorien/build`'s CLI gets a new subcommand that serves the built SPA and opens it in a browser

What's NOT here (deferred to later sub-projects):
- Visual graph editor (sub-project #4)
- Code editor with TS LSP (sub-project #5)
- Run/debug UX (sub-project #7)
- Backend bridge to file system + runtime (sub-project #8, "`@lorien/ide-server`")
- Real file operations (load/save workflows from disk)
- Multi-trigger workflow scenarios (the file tree just shows files, doesn't yet parse them)

---

## Tech stack

| Choice | Going with | Why |
|---|---|---|
| Framework | **Vite + React 19 + TypeScript** | Fast dev, ESM-native, mainstream. No SSR needed. |
| Styling | **Tailwind v4 + shadcn/ui** | Already settled in earlier brainstorm. Modern v4 uses CSS-first config (no `tailwind.config.js`). |
| Docking | **dockview-react** | Purpose-built for VSCode-style movable/dockable panes. Actively maintained as of 2026. Handles split, tab grouping, dock-anywhere, persistence. |
| State | **Zustand** | Small, hooks-first, no boilerplate. Adequate for shell-level state (open tabs, selected file). |
| Icons | **lucide-react** | The shadcn default. Tree-shakeable, broad coverage. |
| Test runner | **Vitest 4 + Testing Library** | Consistent with the rest of the monorepo. |
| File watcher (build) | **Vite dev server** (`pnpm dev`) | Reload-on-save during shell dev. |

Build output is a static SPA in `packages/ide/dist/` — pure HTML+JS+CSS. The `lorien ide` command (in @lorien/build) serves it from disk.

---

## Layout architecture

Dockview's panel model:
- A **dockview** has multiple **groups**. Each group can hold one or more **panels**.
- Panels can be **dragged** between groups, **split** (creates new groups), **closed**.
- The layout is persisted as a JSON blob.

Default layout matching Layout B:

```
┌──────────┬─────────────────────┬───────────────┐
│          │                     │               │
│  group:  │      group:         │   group:      │
│   left   │      center         │    right      │
│          │                     │               │
│ • Files  │ • <tab strip>       │ • Inspect     │
│   panel  │ • <editor panel>    │ • Tests       │
│          │                     │ • Run         │
└──────────┴─────────────────────┴───────────────┘
```

Three groups at startup. The user can drag panels around — e.g., move "Files" into the right column or split the center group.

`dockview-react` exposes:
- `<DockviewReact>` — root component
- `onReady({ api })` — register panels programmatically
- `api.fromJSON(serialized)` / `api.toJSON()` — persistence

---

## Panel inventory (all in this sub-project)

### Files panel (left default)

A scrollable tree of workflows and nodes:

```
WORKFLOWS
├─ users
│  ├─ create.workflow
│  └─ [id]
│     └─ get.workflow

NODES
├─ shared
│  ├─ parseBody.ts
│  └─ validateEmail.ts
└─ users
   └─ saveUser.ts
```

For v1 of the shell: mock data (a hard-coded sample structure). Clicking a leaf node fires an `onFileOpen` callback. The Zustand store tracks open files; the center panel's tab strip reflects that state.

### Tab strip + editor placeholder (center default)

Tab strip across the top of the center group. Each tab shows the file's display name + a close button.

Below the tab strip: a placeholder card with a message about which sub-project will fill this area (e.g., "Workflow editor — sub-project #4" or "Code editor — sub-project #5"). For now, hovering on tabs that aren't selected dims them; the active tab's content is what shows.

Closing a tab removes it from the open-files store.

### Inspector panel (right default)

A `Tabs` component (shadcn) with three tabs: **Inspect**, **Tests**, **Run**. Each tab renders a placeholder card matching the design spec §7.5 / §7.6 wireframes.

The right panel is fixed-tab — users can split/move the inspector group but the tabs within stay together.

---

## Persistence

On load:
1. Read `localStorage.getItem("lorien-ide-layout")`
2. If present, `api.fromJSON(parsed)`
3. Otherwise, build the default Layout B arrangement programmatically

On layout change (dockview fires `onDidLayoutChange`):
1. Serialize via `api.toJSON()`
2. Write to localStorage

Open-files state is ALSO persisted (which files are tabs, which one is active). Stored under `lorien-ide-tabs`.

---

## `lorien ide` integration

A new subcommand in `@lorien/build`:

```bash
lorien ide [--port 3737] [--no-open]
```

What it does:
1. Locates the @lorien/ide package's `dist/` directory (resolved from @lorien/build's own node_modules — installed as a peer or direct dep)
2. Starts an HTTP server serving `dist/` as static files
3. Opens the browser to `http://localhost:<port>` (unless `--no-open`)
4. Logs the URL to stdout

NO backend bridge yet in this sub-project — the SPA reads its file tree from a hard-coded fixture in dev. The backend bridge (sub-project #8) replaces this.

`@lorien/ide` is added as a dependency of `@lorien/build` so the `dist/` is available when installed.

For development of the IDE itself (`pnpm dev` in `packages/ide/`), Vite's own dev server handles things. `lorien ide` is for the production-deployed flow.

---

## File structure (after this sub-project completes)

```
packages/ide/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── tailwind.config.ts          # if needed; v4 may not require
├── postcss.config.mjs           # may be inline in vite.config
├── components.json              # shadcn config
├── src/
│   ├── main.tsx                 # entry
│   ├── app.tsx                  # root component
│   ├── layout/
│   │   ├── dock-view.tsx        # dockview-react setup
│   │   └── default-layout.ts    # the Layout B arrangement
│   ├── panels/
│   │   ├── files-panel.tsx      # left tree
│   │   ├── tabs-strip.tsx       # center tab strip
│   │   ├── editor-placeholder.tsx
│   │   └── inspector-panel.tsx  # right with shadcn Tabs
│   ├── store/
│   │   ├── tabs.ts              # zustand store: open files, active tab
│   │   └── layout.ts            # persistence helpers
│   ├── data/
│   │   └── mock-files.ts        # hard-coded file tree for v0
│   ├── components/
│   │   └── ui/                  # shadcn-installed components (Button, Tabs, etc.)
│   ├── lib/
│   │   └── utils.ts             # cn() helper from shadcn
│   ├── globals.css              # tailwind directives + theme tokens
│   └── __tests__/               # vitest + testing-library
```

---

## Plan #4 task structure

This will be expanded into the detailed plan, but at a glance:

1. `@lorien/ide` package scaffold (Vite + React + TS + Vitest)
2. Tailwind v4 + shadcn installation + base components
3. dockview-react integration + default Layout B
4. Files panel with mock data + click-to-open
5. Zustand store for open tabs + active tab
6. Tabs strip in the center group
7. Editor placeholder content (per-tab card)
8. Inspector panel with shadcn Tabs
9. Layout persistence to localStorage
10. `lorien ide` command in @lorien/build
11. Acceptance: clicking through the IDE works end-to-end; refresh persists layout

~11 tasks. Smaller than Plan #1 or Plan #2 because the scope is intentionally tight — the goal is a working visual shell, not the full editor functionality.

---

## Acceptance for sub-project #3

A user installs `@lorien/build@0.2.0` (the version that adds `lorien ide`) and runs `npx lorien ide` from any directory. The browser opens. They see:

1. Three docked panels in Layout B
2. A file tree on the left with sample workflows + nodes
3. Click a file → opens as a tab in the center
4. Tabs can be closed
5. Inspector tabs on the right (Inspect / Tests / Run) — each shows a placeholder card
6. They can drag panels to reorganize the layout
7. Refresh the page → layout + open tabs are preserved

This proves the React/dockview/shadcn foundation works end-to-end. Every later sub-project (graph editor, code editor, debugger) drops into the existing panels.
