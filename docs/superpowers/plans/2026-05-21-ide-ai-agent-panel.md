# IDE AI Agent — Plan C: Agents Panel + Chat View

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-visible Agents pane in the lorien IDE — a new dockview tab that hosts a multi-chat surface, an agent picker, and a chat view that streams events from the Plan B WebSocket broker and renders normalized cards. End state: a user opens the IDE, clicks the Agents tab, picks Claude, sends a message, and watches Claude read/edit their workflow files in real time.

**Architecture:** New `packages/ide/src/panels/agents/` directory with small focused components (panel shell, sub-tab strip, agent picker, chat view, cards, input bar). A Zustand store (`useAgentChats`) owns chat list, per-chat transcripts, and the single WebSocket connection. The store talks to the Plan B broker at `${VITE_LORIEN_API_URL}/__lorien/agents/*` (default `http://localhost:3000`). Hydration on init via REST; live event stream via WS; on disconnect, exponential-backoff reconnect + REST re-fetch (Plan B does not implement WS replay).

**Tech Stack:** React 19, Zustand, dockview-react, native WebSocket, `react-markdown` (new dep), shadcn-style Tailwind UI. No new test infra — existing Vitest + jsdom + @testing-library/react.

**Spec reference:** `docs/superpowers/specs/2026-05-21-ide-ai-agent-panel-design.md` §3.2 (IDE shape), §5 (UI specification), §7 (edge cases).
**Plan B reference:** `docs/superpowers/plans/2026-05-21-ide-ai-agent-broker.md` (the broker this plan consumes).

---

## Scope, in and out

**In v1 of Plan C:**
- New `agents` dockview pane added to Inspector's tab group; Inspector stays default-visible.
- Window > Panes > Agents menu item.
- Sub-tab strip inside the panel for multiple concurrent chats + `+` new-chat button + per-tab close (✕).
- Agent picker (new-chat initial state) — fetches `/__lorien/agents/availability`, renders Claude / Codex cards with install status.
- Chat view: message stream with 5 card types (`AssistantText`, `ToolUseRead`/`Grep` compact, `ToolUseEdit`/`Write` with "view diff" hint, `ToolUseBash` with command + exit code, `AssistantError`).
- Input bar — plain `<textarea>` for v1 (Monaco-based input is deferred).
- WebSocket client managed inside `useAgentChats` — single WS shared across all chats.
- Hydration: on store init, GET `/__lorien/agents/chats` for the chat list. On chat open, GET `/__lorien/agents/chats/:id` for full transcript.
- Reconnect: exponential backoff (1s → 30s cap). On reconnect, re-fetch active chat's transcript to recover any missed events.
- Empty state (no chats): centered CTA opens the picker.

**Deferred (explicit non-goals):**
- Monaco-based input bar (uses plain `<textarea>` in v1).
- "view diff" actual diff viewer — the button is rendered but only logs/no-ops in v1.
- Approval cards for shell — Plan B uses `bypassPermissions`, so there's nothing to approve.
- Codex chats — picker shows Codex card but `Start chat` posts `new_chat agent: "codex"` which the broker rejects with `agent_error`. The card surfaces "Coming soon" instead.
- WS replay-on-reconnect — falls back to REST re-fetch.
- Persistent chat order (always sorted server-side by `lastEventAt`).
- Per-message timestamp UI.
- Token usage UI from `turn_done` events.
- Slash commands inside the chat input.

These deferrals make Plan C tractable as one plan while still delivering the end-to-end visible feature.

---

## Decisions locked in this plan

- **Backend URL:** `import.meta.env.VITE_LORIEN_API_URL` with fallback `http://localhost:3000`. WS URL derived by swapping `http(s)://` → `ws(s)://`. A single small `api.ts` exports `restBase()` and `wsUrl()`.
- **One WS per IDE instance, not per chat.** The store opens one connection and multiplexes by `chatId` in messages. Reconnect logic is centralized.
- **No `eventSeq` / replay handling in the WS protocol** — Plan B doesn't implement it. On reconnect, re-issue `open_chat` and rely on REST re-fetch for missed events.
- **`agent_error` UX:** Renders as an inline error card; chat stays open; user can retry by sending another message (which respawns the subprocess if it had died).
- **Input bar = `<textarea>`** for v1. The IDE already uses Monaco for the Code pane; making the chat input use Monaco adds complexity (theming, autocomplete config, lifecycle) for marginal benefit when chat input is short. Defer.
- **No `view diff` integration in v1.** The Edit card renders the diff hint as a button that's wired through but no-ops (logs to console). A follow-up plan integrates Monaco's diff editor or jumps to file location.
- **Codex card behavior:** Picker shows it grayed out with "Coming soon" label. `Start chat` button on the Codex card is disabled. No `new_chat agent: "codex"` is ever sent.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `packages/ide/package.json` | Modify | Add `react-markdown` dep. |
| `packages/ide/src/lib/api.ts` | Create | `restBase()` + `wsUrl()` derived from `VITE_LORIEN_API_URL`. |
| `packages/ide/src/layout/default-layout.ts` | Modify | Add `agents` to `PaneId` / `PANE_IDS` / `PANE_TITLES`; `buildDefaultLayout` adds Agents into Inspector's tab group + re-activates Inspector; `reopenPanel` handles `agents`. |
| `packages/ide/src/layout/default-layout.test.ts` | Modify | Add a test that `agents` is reopenable. |
| `packages/ide/src/layout/dock-view.tsx` | Modify | Register `agents` in the `components` map. |
| `packages/ide/src/store/agent-chats.ts` | Create | Zustand store: chat list, per-chat state, WS client, hydration, send/cancel/new_chat actions. |
| `packages/ide/src/store/agent-chats.test.ts` | Create | Store tests (state transitions, mocked WS). |
| `packages/ide/src/panels/agents/agents-panel.tsx` | Create | Top-level pane: reads store, renders strip + active sub-tab content. |
| `packages/ide/src/panels/agents/sub-tab-strip.tsx` | Create | Horizontal chat tab strip with `+` new and per-tab `✕` close. |
| `packages/ide/src/panels/agents/empty-state.tsx` | Create | Centered CTA when no chats exist. |
| `packages/ide/src/panels/agents/agent-picker.tsx` | Create | Two-card picker; fetches availability; starts chat. |
| `packages/ide/src/panels/agents/chat-view.tsx` | Create | Header + scrollable card list + input bar wrapper. |
| `packages/ide/src/panels/agents/input-bar.tsx` | Create | Textarea + send button; disabled while turn in flight. |
| `packages/ide/src/panels/agents/cards.tsx` | Create | `AssistantText`, `ToolUseRead`, `ToolUseEdit`, `ToolUseBash`, `AssistantError`, `UserMessage`. |
| `packages/ide/src/panels/agents/agent-picker.test.tsx` | Create | Render test with mocked fetch. |
| `packages/ide/src/panels/agents/chat-view.test.tsx` | Create | Render test feeding canned events. |
| `packages/ide/src/panels/agents/cards.test.tsx` | Create | Per-card render tests. |
| `packages/ide/src/components/topbar.tsx` | Modify | Confirm `agents` shows up in the Window > Panes submenu (drives off `PANE_IDS` already — should be automatic). |

19 files total (mostly new). Net additions; no deletions.

---

## Task 1: Add `react-markdown` dependency

**Files:**
- Modify: `packages/ide/package.json`

- [ ] **Step 1: Look up latest stable version**

```
pnpm view react-markdown version
```

Record the major.minor — `react-markdown` is at ~9.x in late 2025. Use `^` ranges.

- [ ] **Step 2: Add to IDE dependencies**

Edit `packages/ide/package.json`, append to `dependencies` (keep alphabetical order — between `radix-ui` and `react`):

```jsonc
{
  "dependencies": {
    // ... existing ...
    "react-markdown": "^<latest>",
    // ... existing react, react-dom ...
  }
}
```

- [ ] **Step 3: Install**

```
pnpm install
```

Expected: install completes cleanly, no peer-dep warnings beyond pre-existing ones.

- [ ] **Step 4: Verify existing IDE tests still pass**

```
pnpm --filter @darrylondil/lorien-ide test
```

Expected: green.

- [ ] **Step 5: Commit**

```
git add packages/ide/package.json pnpm-lock.yaml
git commit -m "chore(ide): add react-markdown for agent chat rendering"
```

---

## Task 2: Backend URL helper

A tiny module that derives REST and WS base URLs from Vite env, with a sensible fallback. Used by both the store and the agent picker.

**Files:**
- Create: `packages/ide/src/lib/api.ts`
- Create: `packages/ide/src/lib/api.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ide/src/lib/api.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

describe("api URL helpers", () => {
  const originalEnv = (import.meta as ImportMeta & { env: Record<string, string> })
    .env

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    // Restore Vite env to its starting state
    Object.assign(
      (import.meta as ImportMeta & { env: Record<string, string> }).env,
      originalEnv,
    )
  })

  it("restBase() defaults to http://localhost:3000", async () => {
    const { restBase } = await import("./api.js")
    // In Node/test env there's no Vite env var by default
    expect(restBase()).toBe("http://localhost:3000")
  })

  it("wsUrl() converts http to ws and appends the broker path", async () => {
    const { wsUrl } = await import("./api.js")
    expect(wsUrl()).toBe("ws://localhost:3000/__lorien/agents/ws")
  })

  it("wsUrl() converts https to wss", async () => {
    ;(import.meta as ImportMeta & { env: Record<string, string> }).env
      .VITE_LORIEN_API_URL = "https://api.example.com"
    const { wsUrl } = await import("./api.js")
    expect(wsUrl()).toBe("wss://api.example.com/__lorien/agents/ws")
  })

  it("restBase() respects VITE_LORIEN_API_URL", async () => {
    ;(import.meta as ImportMeta & { env: Record<string, string> }).env
      .VITE_LORIEN_API_URL = "http://10.0.0.5:8080"
    const { restBase } = await import("./api.js")
    expect(restBase()).toBe("http://10.0.0.5:8080")
  })
})
```

- [ ] **Step 2: Run, expect failure**

```
pnpm --filter @darrylondil/lorien-ide test -- api.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `api.ts`**

Create `packages/ide/src/lib/api.ts`:

```ts
/**
 * Base URLs for the lorien dev-server agent broker.
 *
 * In development, the IDE runs on Vite's dev server (e.g. port 5173) while
 * the lorien runtime / broker runs separately (default port 3000). Set
 * `VITE_LORIEN_API_URL` to point at the runtime when they differ.
 */

const DEFAULT_BASE = "http://localhost:3000"

export function restBase(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env
  return env?.VITE_LORIEN_API_URL ?? DEFAULT_BASE
}

export function wsUrl(): string {
  const base = restBase()
  const wsScheme = base.startsWith("https://") ? "wss://" : "ws://"
  const host = base.replace(/^https?:\/\//, "")
  return `${wsScheme}${host}/__lorien/agents/ws`
}
```

- [ ] **Step 4: Run, confirm pass**

```
pnpm --filter @darrylondil/lorien-ide test -- api.test
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```
git add packages/ide/src/lib/api.ts packages/ide/src/lib/api.test.ts
git commit -m "feat(ide): api base URL helpers for agent broker REST + WS"
```

---

## Task 3: Register `agents` pane in dockview layout

**Files:**
- Modify: `packages/ide/src/layout/default-layout.ts`
- Modify: `packages/ide/src/layout/dock-view.tsx`
- Modify: `packages/ide/src/layout/default-layout.test.ts`

The Agents pane joins the Inspector tab group on the right. Inspector stays the default-visible tab.

- [ ] **Step 1: Update `PaneId`, `PANE_IDS`, `PANE_TITLES`**

In `packages/ide/src/layout/default-layout.ts`, find the three exports near the top:

```ts
export type PaneId = "files" | "workflow" | "code" | "inspector"
export const PANE_IDS = ["files", "workflow", "code", "inspector"] as const
export const PANE_TITLES: Record<PaneId, string> = {
  files: "Files",
  workflow: "Workflow",
  code: "Code",
  inspector: "Inspector",
}
```

Replace with:

```ts
export type PaneId = "files" | "workflow" | "code" | "inspector" | "agents"
export const PANE_IDS = ["files", "workflow", "code", "inspector", "agents"] as const
export const PANE_TITLES: Record<PaneId, string> = {
  files: "Files",
  workflow: "Workflow",
  code: "Code",
  inspector: "Inspector",
  agents: "Agents",
}
```

- [ ] **Step 2: Update `buildDefaultLayout`**

In the same file, find `buildDefaultLayout`. After the existing `api.addPanel({ id: "inspector", ... })` call, append:

```ts
  api.addPanel({
    id: "agents",
    component: "agents",
    title: "Agents",
    position: { referencePanel: "inspector", direction: "within" },
  })
  // Inspector stays the default-visible tab in its group — dockview otherwise
  // activates the most recently added panel.
  api.getPanel("inspector")?.api.setActive()
```

- [ ] **Step 3: Update `reopenPanel`**

In the same file, find the `reopenPanel` function. It already handles `files`, `inspector`, and the workflow/code default. Add an `agents` branch. The full updated function:

```ts
export function reopenPanel(api: DockviewApi, id: PaneId): void {
  if (api.getPanel(id)) return

  const options: AddPanelOptions = {
    id,
    component: id,
    title: PANE_TITLES[id],
  }

  if (id === "files") {
    const ref = api.getPanel("workflow") ?? api.getPanel("code") ?? api.getPanel("inspector")
    if (ref) options.position = { referencePanel: ref.id, direction: "left" }
    options.initialWidth = 250
  } else if (id === "inspector") {
    const ref = api.getPanel("code") ?? api.getPanel("workflow") ?? api.getPanel("files")
    if (ref) options.position = { referencePanel: ref.id, direction: "right" }
    options.initialWidth = 400
  } else if (id === "agents") {
    // Prefer joining Inspector's group; fall back to a new pane on the right.
    const inspector = api.getPanel("inspector")
    if (inspector) {
      options.position = { referencePanel: inspector.id, direction: "within" }
    } else {
      const ref = api.getPanel("code") ?? api.getPanel("workflow") ?? api.getPanel("files")
      if (ref) options.position = { referencePanel: ref.id, direction: "right" }
      options.initialWidth = 400
    }
  } else {
    // workflow or code — prefer joining the sibling editor group
    const sibling: PaneId = id === "workflow" ? "code" : "workflow"
    const siblingPanel = api.getPanel(sibling)
    if (siblingPanel) {
      options.position = { referencePanel: siblingPanel.id, direction: "within" }
    } else if (api.getPanel("files")) {
      options.position = { referencePanel: "files", direction: "right" }
    } else if (api.getPanel("inspector")) {
      options.position = { referencePanel: "inspector", direction: "left" }
    }
  }

  api.addPanel(options)
  api.getPanel(id)?.api.setActive()
}
```

- [ ] **Step 4: Update the dockview component map**

In `packages/ide/src/layout/dock-view.tsx`, add the `AgentsPanel` import + component entry. The current `components` object is:

```tsx
const components = {
  files: (_props: IDockviewPanelProps) => <FilesPanel />,
  workflow: (_props: IDockviewPanelProps) => <WorkflowEditorPanel />,
  code: (_props: IDockviewPanelProps) => <CodeEditorPanel />,
  inspector: (_props: IDockviewPanelProps) => <InspectorPanel />,
}
```

The `AgentsPanel` component doesn't exist yet (Task 4 creates it). For now, add a placeholder that returns null and import the real component once it exists. Update the file:

```tsx
import { AgentsPanel } from "@/panels/agents/agents-panel"
// ... existing imports ...

const components = {
  files: (_props: IDockviewPanelProps) => <FilesPanel />,
  workflow: (_props: IDockviewPanelProps) => <WorkflowEditorPanel />,
  code: (_props: IDockviewPanelProps) => <CodeEditorPanel />,
  inspector: (_props: IDockviewPanelProps) => <InspectorPanel />,
  agents: (_props: IDockviewPanelProps) => <AgentsPanel />,
}
```

(Until Task 4 creates `AgentsPanel`, this import will be a typecheck error. Don't run typecheck until Task 4 lands; Step 5 of this task verifies only the .ts file changes.)

Actually to keep this task self-contained and let typecheck pass, create a TEMPORARY placeholder for now:

Create `packages/ide/src/panels/agents/agents-panel.tsx` with minimal content:

```tsx
export function AgentsPanel(): React.ReactElement {
  return <div className="p-4 text-sm text-muted-foreground">Agents panel — coming soon</div>
}
```

This unblocks the import. Task 4 replaces this file with the real implementation.

- [ ] **Step 5: Update default-layout test**

In `packages/ide/src/layout/default-layout.test.ts`, append a new `describe` block to test the new pane:

```ts
import { reopenPanel, type PaneId, PANE_IDS, PANE_TITLES } from "./default-layout.js"

describe("PANE_IDS and PANE_TITLES include agents", () => {
  it("PANE_IDS contains 'agents'", () => {
    expect(PANE_IDS).toContain("agents")
  })
  it("PANE_TITLES.agents is 'Agents'", () => {
    expect(PANE_TITLES.agents).toBe("Agents")
  })
})

describe("reopenPanel for agents", () => {
  it("does not throw when Inspector exists", () => {
    const calls: unknown[] = []
    const api = {
      getPanel: (id: string) => (id === "inspector" ? { id, api: { setActive: () => {} } } : undefined),
      addPanel: (opts: unknown) => calls.push(opts),
    } as unknown as Parameters<typeof reopenPanel>[0]
    reopenPanel(api, "agents" satisfies PaneId)
    expect(calls).toHaveLength(1)
    const opts = calls[0] as { position?: { referencePanel: string; direction: string } }
    expect(opts.position).toEqual({ referencePanel: "inspector", direction: "within" })
  })

  it("falls back to a new pane on the right when Inspector is absent", () => {
    const calls: unknown[] = []
    const api = {
      getPanel: (id: string) => (id === "code" ? { id, api: { setActive: () => {} } } : undefined),
      addPanel: (opts: unknown) => calls.push(opts),
    } as unknown as Parameters<typeof reopenPanel>[0]
    reopenPanel(api, "agents" satisfies PaneId)
    expect(calls).toHaveLength(1)
    const opts = calls[0] as { position?: { referencePanel: string; direction: string }; initialWidth?: number }
    expect(opts.position).toEqual({ referencePanel: "code", direction: "right" })
    expect(opts.initialWidth).toBe(400)
  })
})
```

- [ ] **Step 6: Run tests + typecheck**

```
pnpm --filter @darrylondil/lorien-ide test -- default-layout
pnpm --filter @darrylondil/lorien-ide typecheck
```

Expected: all default-layout tests pass; typecheck clean.

- [ ] **Step 7: Commit**

```
git add packages/ide/src/layout/default-layout.ts packages/ide/src/layout/dock-view.tsx packages/ide/src/layout/default-layout.test.ts packages/ide/src/panels/agents/agents-panel.tsx
git commit -m "feat(ide): register agents pane; default layout joins inspector group"
```

---

## Task 4: `useAgentChats` store skeleton

Zustand store with state types, hydration, and actions — but NO WebSocket yet. The WS client is wired in Task 8.

**Files:**
- Create: `packages/ide/src/store/agent-chats.ts`
- Create: `packages/ide/src/store/agent-chats.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ide/src/store/agent-chats.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest"
import { useAgentChats } from "./agent-chats.js"

function reset(): void {
  // Reset store to initial state between tests
  useAgentChats.setState(useAgentChats.getInitialState())
}

describe("useAgentChats", () => {
  beforeEach(reset)

  it("initial state has no chats, no active chat, picker is closed", () => {
    const s = useAgentChats.getState()
    expect(s.chats).toEqual({})
    expect(s.order).toEqual([])
    expect(s.activeChatId).toBeNull()
    expect(s.availability).toBeNull()
  })

  it("newChat() opens a picker tab with a synthetic id", () => {
    const id = useAgentChats.getState().newChat()
    expect(id).toMatch(/^picker-/)
    const s = useAgentChats.getState()
    expect(s.order).toContain(id)
    expect(s.chats[id]?.kind).toBe("picker")
    expect(s.activeChatId).toBe(id)
  })

  it("setActive() switches the active sub-tab", () => {
    const a = useAgentChats.getState().newChat()
    const b = useAgentChats.getState().newChat()
    expect(useAgentChats.getState().activeChatId).toBe(b)
    useAgentChats.getState().setActive(a)
    expect(useAgentChats.getState().activeChatId).toBe(a)
  })

  it("closeTab() removes a chat and falls back to the previous one", () => {
    const a = useAgentChats.getState().newChat()
    const b = useAgentChats.getState().newChat()
    useAgentChats.getState().closeTab(b)
    const s = useAgentChats.getState()
    expect(s.order).toEqual([a])
    expect(s.activeChatId).toBe(a)
  })

  it("closeTab() clears activeChatId when the last tab closes", () => {
    const a = useAgentChats.getState().newChat()
    useAgentChats.getState().closeTab(a)
    expect(useAgentChats.getState().activeChatId).toBeNull()
  })

  it("setAvailability() stores the probed response", () => {
    useAgentChats.getState().setAvailability({
      claude: { installed: true, version: "1.0.0" },
      codex: { installed: false },
    })
    const av = useAgentChats.getState().availability
    expect(av?.claude.installed).toBe(true)
    expect(av?.codex.installed).toBe(false)
  })

  it("setChatCreated() upgrades a picker tab to a real chat", () => {
    const pickerId = useAgentChats.getState().newChat()
    useAgentChats.getState().setChatCreated(pickerId, "real-chat-1", "claude")
    const s = useAgentChats.getState()
    expect(s.chats[pickerId]).toBeUndefined()
    expect(s.chats["real-chat-1"]?.kind).toBe("chat")
    expect(s.activeChatId).toBe("real-chat-1")
    expect(s.order).toEqual(["real-chat-1"])
  })

  it("appendEvent() adds to the chat's event list", () => {
    useAgentChats.getState().setChatCreated("picker-1", "c1", "claude")
    useAgentChats.getState().appendEvent("c1", {
      kind: "assistant_text",
      text: "hi",
      turnId: "t",
      at: "2026-05-21T00:00:00Z",
    })
    const chat = useAgentChats.getState().chats["c1"]
    if (chat?.kind === "chat") {
      expect(chat.events).toHaveLength(1)
      expect(chat.events[0]!.kind).toBe("assistant_text")
    } else {
      throw new Error("expected chat kind")
    }
  })

  it("hydrate() loads chat list via fetch", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/__lorien/agents/chats")) {
        return new Response(
          JSON.stringify({
            version: 1,
            chats: [
              {
                id: "c1",
                agent: "claude",
                title: "First",
                createdAt: "2026-05-21T00:00:00Z",
                lastEventAt: "2026-05-21T00:00:00Z",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        )
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    await useAgentChats.getState().hydrate()
    const s = useAgentChats.getState()
    expect(s.order).toEqual(["c1"])
    expect(s.chats["c1"]?.kind).toBe("chat")
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run, expect failure**

```
pnpm --filter @darrylondil/lorien-ide test -- agent-chats.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `packages/ide/src/store/agent-chats.ts`:

```ts
import { create } from "zustand"
import { restBase } from "@/lib/api"

// Mirror the broker's public types. We don't import from
// "@darrylondil/lorien-runtime/agent-broker" because that pulls in node-only
// modules (ws, child_process). The shapes are intentionally identical to the
// broker's public protocol — see plan §4.2.

export type AgentName = "claude" | "codex"

export type ToolKind = "Read" | "Edit" | "Write" | "Bash" | "Grep" | "Other"

export type AgentEvent =
  | { kind: "user_message"; text: string; at: string }
  | { kind: "assistant_text"; text: string; turnId: string; at: string }
  | {
      kind: "tool_use"
      toolUseId: string
      tool: ToolKind
      input: unknown
      status: "started" | "completed" | "denied" | "pending_approval"
      at: string
    }
  | { kind: "tool_result"; toolUseId: string; ok: boolean; summary?: string; at: string }
  | {
      kind: "turn_done"
      turnId: string
      usage?: { inputTokens: number; outputTokens: number }
      at: string
    }

export interface AgentAvailability {
  installed: boolean
  version?: string
  authed?: boolean
}

export interface AvailabilityResponse {
  claude: AgentAvailability
  codex: AgentAvailability
}

interface PickerTab {
  kind: "picker"
  id: string
}

interface ChatTab {
  kind: "chat"
  id: string
  agent: AgentName
  title: string
  events: AgentEvent[]
  turnInFlight: boolean
  error: string | null
}

type Tab = PickerTab | ChatTab

interface AgentChatsState {
  chats: Record<string, Tab>
  order: string[]
  activeChatId: string | null
  availability: AvailabilityResponse | null

  newChat(): string
  setActive(id: string | null): void
  closeTab(id: string): void
  setAvailability(av: AvailabilityResponse): void
  setChatCreated(pickerId: string, realId: string, agent: AgentName): void
  appendEvent(chatId: string, event: AgentEvent): void
  setError(chatId: string, error: string | null): void
  setTurnInFlight(chatId: string, inFlight: boolean): void
  hydrate(): Promise<void>
}

let pickerCounter = 0

export const useAgentChats = create<AgentChatsState>((set, get) => ({
  chats: {},
  order: [],
  activeChatId: null,
  availability: null,

  newChat() {
    pickerCounter += 1
    const id = `picker-${Date.now()}-${pickerCounter}`
    set((s) => ({
      chats: { ...s.chats, [id]: { kind: "picker", id } satisfies PickerTab },
      order: [...s.order, id],
      activeChatId: id,
    }))
    return id
  },

  setActive(id) {
    set({ activeChatId: id })
  },

  closeTab(id) {
    set((s) => {
      const { [id]: _drop, ...rest } = s.chats
      const order = s.order.filter((x) => x !== id)
      let active = s.activeChatId
      if (active === id) {
        const idx = s.order.indexOf(id)
        active = order[Math.max(0, idx - 1)] ?? order[0] ?? null
      }
      return { chats: rest, order, activeChatId: active }
    })
  },

  setAvailability(av) {
    set({ availability: av })
  },

  setChatCreated(pickerId, realId, agent) {
    set((s) => {
      const { [pickerId]: _drop, ...rest } = s.chats
      const chatTab: ChatTab = {
        kind: "chat",
        id: realId,
        agent,
        title: "untitled",
        events: [],
        turnInFlight: false,
        error: null,
      }
      const order = s.order.map((x) => (x === pickerId ? realId : x))
      return {
        chats: { ...rest, [realId]: chatTab },
        order,
        activeChatId: s.activeChatId === pickerId ? realId : s.activeChatId,
      }
    })
  },

  appendEvent(chatId, event) {
    set((s) => {
      const tab = s.chats[chatId]
      if (!tab || tab.kind !== "chat") return s
      let title = tab.title
      if (title === "untitled" && event.kind === "user_message") {
        title = event.text.slice(0, 60)
      }
      const updated: ChatTab = {
        ...tab,
        events: [...tab.events, event],
        title,
        turnInFlight: event.kind === "turn_done" ? false : tab.turnInFlight,
      }
      return { chats: { ...s.chats, [chatId]: updated } }
    })
  },

  setError(chatId, error) {
    set((s) => {
      const tab = s.chats[chatId]
      if (!tab || tab.kind !== "chat") return s
      return { chats: { ...s.chats, [chatId]: { ...tab, error } } }
    })
  },

  setTurnInFlight(chatId, inFlight) {
    set((s) => {
      const tab = s.chats[chatId]
      if (!tab || tab.kind !== "chat") return s
      return { chats: { ...s.chats, [chatId]: { ...tab, turnInFlight: inFlight } } }
    })
  },

  async hydrate() {
    try {
      const res = await fetch(`${restBase()}/__lorien/agents/chats`)
      if (!res.ok) return
      const idx = (await res.json()) as {
        version: 1
        chats: Array<{
          id: string
          agent: AgentName
          title: string
          createdAt: string
          lastEventAt: string
        }>
      }
      set((s) => {
        const next: Record<string, Tab> = { ...s.chats }
        const order: string[] = [...s.order]
        for (const c of idx.chats) {
          if (next[c.id]) continue
          next[c.id] = {
            kind: "chat",
            id: c.id,
            agent: c.agent,
            title: c.title,
            events: [],
            turnInFlight: false,
            error: null,
          }
          order.push(c.id)
        }
        return { chats: next, order }
      })
    } catch {
      // network failure during hydrate is non-fatal — user sees an empty list,
      // can retry by opening the panel again or refreshing
    }
  },
}))
```

- [ ] **Step 4: Run tests, confirm pass**

```
pnpm --filter @darrylondil/lorien-ide test -- agent-chats.test
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```
git add packages/ide/src/store/agent-chats.ts packages/ide/src/store/agent-chats.test.ts
git commit -m "feat(ide): useAgentChats store — tabs, hydration, event appends"
```

---

## Task 5: AgentsPanel shell + SubTabStrip

The top-level pane. Reads from the store, renders the sub-tab strip + the active sub-tab content (either a picker or a chat view). Both are placeholders for now — picker comes in Task 6, chat view in Task 7.

**Files:**
- Modify: `packages/ide/src/panels/agents/agents-panel.tsx` (replace the Task 3 placeholder)
- Create: `packages/ide/src/panels/agents/sub-tab-strip.tsx`
- Create: `packages/ide/src/panels/agents/empty-state.tsx`

- [ ] **Step 1: Create the empty state**

Create `packages/ide/src/panels/agents/empty-state.tsx`:

```tsx
interface EmptyStateProps {
  onStart(): void
}

export function EmptyState({ onStart }: EmptyStateProps): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-sm text-muted-foreground">
        Chat with an AI agent to edit workflows and nodes in this project.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
      >
        Start your first chat
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Create the sub-tab strip**

Create `packages/ide/src/panels/agents/sub-tab-strip.tsx`:

```tsx
import { Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAgentChats } from "@/store/agent-chats"

export function SubTabStrip(): React.ReactElement {
  const order = useAgentChats((s) => s.order)
  const chats = useAgentChats((s) => s.chats)
  const activeChatId = useAgentChats((s) => s.activeChatId)
  const setActive = useAgentChats((s) => s.setActive)
  const closeTab = useAgentChats((s) => s.closeTab)
  const newChat = useAgentChats((s) => s.newChat)

  return (
    <div className="flex h-8 shrink-0 items-center gap-px overflow-x-auto border-b bg-muted/30 px-1">
      {order.map((id) => {
        const tab = chats[id]
        const label = tab?.kind === "chat" ? tab.title : "New chat"
        const active = id === activeChatId
        return (
          <div
            key={id}
            className={cn(
              "group flex h-6 shrink-0 items-center gap-1 rounded-sm border border-transparent px-2 text-xs cursor-pointer",
              active
                ? "border-border bg-background text-foreground"
                : "text-muted-foreground hover:bg-accent/40",
            )}
            onClick={() => setActive(id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setActive(id)
            }}
            role="tab"
            tabIndex={0}
            aria-selected={active}
          >
            <span className="max-w-[120px] truncate">{label}</span>
            <button
              type="button"
              aria-label="Close chat"
              className="opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(id)
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        aria-label="New chat"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent/40"
        onClick={() => newChat()}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Replace the AgentsPanel placeholder with the real shell**

Replace the contents of `packages/ide/src/panels/agents/agents-panel.tsx`:

```tsx
import { useEffect } from "react"
import { useAgentChats } from "@/store/agent-chats"
import { EmptyState } from "./empty-state"
import { SubTabStrip } from "./sub-tab-strip"

export function AgentsPanel(): React.ReactElement {
  const order = useAgentChats((s) => s.order)
  const activeChatId = useAgentChats((s) => s.activeChatId)
  const chats = useAgentChats((s) => s.chats)
  const newChat = useAgentChats((s) => s.newChat)
  const hydrate = useAgentChats((s) => s.hydrate)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  if (order.length === 0) {
    return <EmptyState onStart={() => newChat()} />
  }

  const active = activeChatId ? chats[activeChatId] : undefined

  return (
    <div className="flex h-full flex-col">
      <SubTabStrip />
      <div className="flex-1 overflow-hidden">
        {active?.kind === "picker" && (
          <div className="p-4 text-sm text-muted-foreground">
            Agent picker — Task 6 will replace this.
          </div>
        )}
        {active?.kind === "chat" && (
          <div className="p-4 text-sm text-muted-foreground">
            Chat view — Task 7 will replace this. Chat id: {active.id}
          </div>
        )}
        {!active && (
          <div className="p-4 text-sm text-muted-foreground">No active chat.</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck + manual sanity**

```
pnpm --filter @darrylondil/lorien-ide typecheck
```

Expected: clean (cn + lucide-react + Plus/X all already in IDE deps).

```
pnpm --filter @darrylondil/lorien-ide test
```

Expected: all tests still pass (no new tests in this task — the components are visual; full integration test waits for Task 9).

- [ ] **Step 5: Commit**

```
git add packages/ide/src/panels/agents/agents-panel.tsx packages/ide/src/panels/agents/sub-tab-strip.tsx packages/ide/src/panels/agents/empty-state.tsx
git commit -m "feat(ide): agents panel shell — sub-tab strip + empty state"
```

---

## Task 6: AgentPicker

The new-chat initial state. Fetches `/__lorien/agents/availability` and renders two cards. Selecting an agent triggers `new_chat` via the WS client (which doesn't yet exist — Task 8 wires it. For now this task posts a placeholder action on the store).

**Files:**
- Create: `packages/ide/src/panels/agents/agent-picker.tsx`
- Create: `packages/ide/src/panels/agents/agent-picker.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/ide/src/panels/agents/agent-picker.test.tsx`:

```tsx
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAgentChats } from "@/store/agent-chats"
import { AgentPicker } from "./agent-picker"

function reset(): void {
  useAgentChats.setState(useAgentChats.getInitialState())
}

const fetchMock = vi.fn()

beforeEach(() => {
  reset()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("AgentPicker", () => {
  it("renders Claude and Codex cards after fetching availability", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          claude: { installed: true, version: "1.2.3" },
          codex: { installed: false },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )
    const pickerId = useAgentChats.getState().newChat()
    render(<AgentPicker pickerId={pickerId} />)
    await waitFor(() => {
      expect(screen.getByText(/Claude Code/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Codex/i)).toBeInTheDocument()
    expect(screen.getByText(/1\.2\.3/)).toBeInTheDocument()
  })

  it("Claude 'Start chat' button is enabled when installed", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          claude: { installed: true },
          codex: { installed: false },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )
    const pickerId = useAgentChats.getState().newChat()
    render(<AgentPicker pickerId={pickerId} />)
    const start = await screen.findByRole("button", { name: /start chat with claude/i })
    expect(start).not.toBeDisabled()
  })

  it("Claude 'Start chat' button is disabled when not installed", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          claude: { installed: false },
          codex: { installed: false },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )
    const pickerId = useAgentChats.getState().newChat()
    render(<AgentPicker pickerId={pickerId} />)
    const start = await screen.findByRole("button", { name: /start chat with claude/i })
    expect(start).toBeDisabled()
  })

  it("Codex card is always disabled and shows 'Coming soon'", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          claude: { installed: true },
          codex: { installed: true, version: "5.0.0" },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )
    const pickerId = useAgentChats.getState().newChat()
    render(<AgentPicker pickerId={pickerId} />)
    await waitFor(() => {
      expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
    })
    const codexStart = screen.getByRole("button", { name: /start chat with codex/i })
    expect(codexStart).toBeDisabled()
  })

  it("clicking Claude 'Start chat' calls store.startClaudeChat", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          claude: { installed: true },
          codex: { installed: false },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )
    const startSpy = vi.fn()
    useAgentChats.setState({ startClaudeChat: startSpy } as unknown as Parameters<
      typeof useAgentChats.setState
    >[0])
    const pickerId = useAgentChats.getState().newChat()
    render(<AgentPicker pickerId={pickerId} />)
    const start = await screen.findByRole("button", { name: /start chat with claude/i })
    fireEvent.click(start)
    expect(startSpy).toHaveBeenCalledWith(pickerId)
  })
})
```

- [ ] **Step 2: Add `startClaudeChat` action to the store**

In `packages/ide/src/store/agent-chats.ts`, add the action to `AgentChatsState`:

```ts
  startClaudeChat(pickerId: string): void
```

…and inside the `create<>(...)` factory body, add the implementation. For now (Task 6) it's a placeholder that the test mocks; Task 8 will replace it with the real WS-based version:

```ts
  startClaudeChat(_pickerId: string) {
    // Real implementation lands in Task 8 — sends `new_chat` over the WS.
    // For now, this is a no-op stub overridden by tests.
  },
```

(Place it between `setTurnInFlight` and `hydrate` to keep alphabetical-ish grouping.)

- [ ] **Step 3: Run, expect failure**

```
pnpm --filter @darrylondil/lorien-ide test -- agent-picker.test
```

Expected: FAIL — `AgentPicker` not found.

- [ ] **Step 4: Implement `AgentPicker`**

Create `packages/ide/src/panels/agents/agent-picker.tsx`:

```tsx
import { useEffect } from "react"
import { restBase } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useAgentChats, type AgentAvailability, type AvailabilityResponse } from "@/store/agent-chats"

interface AgentPickerProps {
  pickerId: string
}

export function AgentPicker({ pickerId }: AgentPickerProps): React.ReactElement {
  const availability = useAgentChats((s) => s.availability)
  const setAvailability = useAgentChats((s) => s.setAvailability)
  const startClaudeChat = useAgentChats((s) => s.startClaudeChat)

  useEffect(() => {
    let cancelled = false
    async function probe(): Promise<void> {
      try {
        const res = await fetch(`${restBase()}/__lorien/agents/availability`)
        if (!res.ok) return
        const av = (await res.json()) as AvailabilityResponse
        if (!cancelled) setAvailability(av)
      } catch {
        /* leave availability null; cards render in error state */
      }
    }
    void probe()
    return () => {
      cancelled = true
    }
  }, [setAvailability])

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="grid w-full max-w-2xl grid-cols-2 gap-4">
        <AgentCard
          name="Claude Code"
          vendor="Anthropic"
          availability={availability?.claude}
          available={availability?.claude.installed === true}
          actionLabel="Start chat with Claude"
          onStart={() => startClaudeChat(pickerId)}
          disabled={availability?.claude.installed !== true}
          comingSoon={false}
        />
        <AgentCard
          name="Codex"
          vendor="OpenAI"
          availability={availability?.codex}
          available={false}
          actionLabel="Start chat with Codex"
          onStart={() => {
            /* never called — Codex is disabled */
          }}
          disabled
          comingSoon
        />
      </div>
    </div>
  )
}

interface AgentCardProps {
  name: string
  vendor: string
  availability: AgentAvailability | undefined
  available: boolean
  actionLabel: string
  onStart(): void
  disabled: boolean
  comingSoon: boolean
}

function AgentCard({
  name,
  vendor,
  availability,
  available,
  actionLabel,
  onStart,
  disabled,
  comingSoon,
}: AgentCardProps): React.ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-background p-4",
        disabled && "opacity-60",
      )}
    >
      <div>
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-muted-foreground">{vendor}</div>
      </div>
      <hr className="border-border" />
      <div className="flex-1 text-xs text-muted-foreground">
        {comingSoon ? (
          <span>Coming soon</span>
        ) : availability === undefined ? (
          <span>Detecting…</span>
        ) : availability.installed ? (
          <span>
            Installed{availability.version ? ` (v${availability.version})` : ""}
          </span>
        ) : (
          <span>
            Not installed — see{" "}
            <a
              href="https://docs.anthropic.com/claude-code"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              install instructions
            </a>
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label={actionLabel}
        onClick={onStart}
        disabled={disabled || !available}
        className={cn(
          "rounded-md border border-border bg-background px-3 py-1.5 text-sm",
          !disabled && available ? "hover:bg-accent" : "cursor-not-allowed",
        )}
      >
        Start chat
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Wire the picker into AgentsPanel**

In `packages/ide/src/panels/agents/agents-panel.tsx`, replace the picker placeholder line:

```tsx
        {active?.kind === "picker" && (
          <div className="p-4 text-sm text-muted-foreground">
            Agent picker — Task 6 will replace this.
          </div>
        )}
```

with:

```tsx
        {active?.kind === "picker" && <AgentPicker pickerId={active.id} />}
```

And add the import:

```tsx
import { AgentPicker } from "./agent-picker"
```

- [ ] **Step 6: Run tests, confirm pass**

```
pnpm --filter @darrylondil/lorien-ide test -- agent-picker.test
```

Expected: 5 picker tests pass; existing store tests still pass.

- [ ] **Step 7: Commit**

```
git add packages/ide/src/panels/agents/agent-picker.tsx packages/ide/src/panels/agents/agent-picker.test.tsx packages/ide/src/panels/agents/agents-panel.tsx packages/ide/src/store/agent-chats.ts
git commit -m "feat(ide): AgentPicker — availability fetch + Claude/Codex cards"
```

---

## Task 7: ChatView shell + InputBar

The chat view shell — header, scrollable card list (cards come in Task 8 — for now, a placeholder that renders raw event kinds), and the input bar. The input bar dispatches a `sendMessage` action on the store (stub for now; Task 8 wires the WS).

**Files:**
- Create: `packages/ide/src/panels/agents/chat-view.tsx`
- Create: `packages/ide/src/panels/agents/chat-view.test.tsx`
- Create: `packages/ide/src/panels/agents/input-bar.tsx`

- [ ] **Step 1: Add `sendMessage` + `cancelTurn` stubs to the store**

In `packages/ide/src/store/agent-chats.ts`, add to the `AgentChatsState` interface:

```ts
  sendMessage(chatId: string, text: string): void
  cancelTurn(chatId: string): void
```

In the factory body (next to `startClaudeChat`):

```ts
  sendMessage(_chatId: string, _text: string) {
    // Real WS-based implementation lands in Task 8.
  },

  cancelTurn(_chatId: string) {
    // Real WS-based implementation lands in Task 8.
  },
```

- [ ] **Step 2: Write the failing chat-view test**

Create `packages/ide/src/panels/agents/chat-view.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useAgentChats } from "@/store/agent-chats"
import { ChatView } from "./chat-view"

function reset(): void {
  useAgentChats.setState(useAgentChats.getInitialState())
}

describe("ChatView", () => {
  beforeEach(reset)

  it("renders the chat title in the header", () => {
    useAgentChats.getState().newChat()
    const pickerId = useAgentChats.getState().order[0]!
    useAgentChats.getState().setChatCreated(pickerId, "c1", "claude")
    render(<ChatView chatId="c1" />)
    // title is "untitled" until a user_message arrives
    expect(screen.getByText(/untitled/i)).toBeInTheDocument()
  })

  it("renders one row per event", () => {
    useAgentChats.getState().newChat()
    const pickerId = useAgentChats.getState().order[0]!
    useAgentChats.getState().setChatCreated(pickerId, "c1", "claude")
    useAgentChats.getState().appendEvent("c1", {
      kind: "user_message",
      text: "hi there",
      at: "2026-05-21T00:00:00Z",
    })
    useAgentChats.getState().appendEvent("c1", {
      kind: "assistant_text",
      text: "hello",
      turnId: "t1",
      at: "2026-05-21T00:00:00Z",
    })
    render(<ChatView chatId="c1" />)
    expect(screen.getAllByTestId("agent-event-row")).toHaveLength(2)
  })

  it("input bar sends a message via the store", () => {
    useAgentChats.getState().newChat()
    const pickerId = useAgentChats.getState().order[0]!
    useAgentChats.getState().setChatCreated(pickerId, "c1", "claude")
    const sendSpy = vi.fn()
    useAgentChats.setState({ sendMessage: sendSpy } as unknown as Parameters<
      typeof useAgentChats.setState
    >[0])
    render(<ChatView chatId="c1" />)
    const textarea = screen.getByRole("textbox", { name: /message/i })
    fireEvent.change(textarea, { target: { value: "do the thing" } })
    fireEvent.click(screen.getByRole("button", { name: /send/i }))
    expect(sendSpy).toHaveBeenCalledWith("c1", "do the thing")
  })

  it("input bar is disabled while turn is in flight", () => {
    useAgentChats.getState().newChat()
    const pickerId = useAgentChats.getState().order[0]!
    useAgentChats.getState().setChatCreated(pickerId, "c1", "claude")
    useAgentChats.getState().setTurnInFlight("c1", true)
    render(<ChatView chatId="c1" />)
    const textarea = screen.getByRole("textbox", { name: /message/i })
    expect(textarea).toBeDisabled()
  })

  it("renders an error banner when the chat has an error", () => {
    useAgentChats.getState().newChat()
    const pickerId = useAgentChats.getState().order[0]!
    useAgentChats.getState().setChatCreated(pickerId, "c1", "claude")
    useAgentChats.getState().setError("c1", "Claude CLI not installed")
    render(<ChatView chatId="c1" />)
    expect(screen.getByText(/Claude CLI not installed/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run, expect failure**

```
pnpm --filter @darrylondil/lorien-ide test -- chat-view.test
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `InputBar`**

Create `packages/ide/src/panels/agents/input-bar.tsx`:

```tsx
import { Send } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

interface InputBarProps {
  disabled: boolean
  onSend(text: string): void
}

export function InputBar({ disabled, onSend }: InputBarProps): React.ReactElement {
  const [text, setText] = useState("")

  function submit(): void {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText("")
  }

  return (
    <div className="flex shrink-0 items-end gap-2 border-t bg-background p-2">
      <textarea
        aria-label="Message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        disabled={disabled}
        placeholder="Ask the agent…"
        rows={2}
        className={cn(
          "flex-1 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs",
          disabled && "opacity-50",
        )}
      />
      <button
        type="button"
        aria-label="Send"
        onClick={submit}
        disabled={disabled || text.trim().length === 0}
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background",
          (disabled || text.trim().length === 0) && "cursor-not-allowed opacity-50",
        )}
      >
        <Send className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Implement `ChatView`**

Create `packages/ide/src/panels/agents/chat-view.tsx`:

```tsx
import { useEffect, useRef } from "react"
import { useAgentChats } from "@/store/agent-chats"
import { InputBar } from "./input-bar"

interface ChatViewProps {
  chatId: string
}

export function ChatView({ chatId }: ChatViewProps): React.ReactElement | null {
  const tab = useAgentChats((s) => s.chats[chatId])
  const sendMessage = useAgentChats((s) => s.sendMessage)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Auto-scroll on new events.
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [tab?.kind === "chat" ? tab.events.length : 0])

  if (!tab || tab.kind !== "chat") return null

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center border-b bg-muted/20 px-3 text-xs">
        <span className="font-medium">{tab.title}</span>
        <span className="ml-2 text-muted-foreground">· {tab.agent}</span>
      </div>
      {tab.error && (
        <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {tab.error}
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {tab.events.map((event, i) => (
          <div
            key={i}
            data-testid="agent-event-row"
            className="mb-2 text-xs text-foreground"
          >
            <span className="font-mono text-muted-foreground">[{event.kind}]</span>{" "}
            {/* Real cards land in Task 8. */}
            {event.kind === "assistant_text" || event.kind === "user_message"
              ? event.text
              : null}
          </div>
        ))}
      </div>
      <InputBar
        disabled={tab.turnInFlight}
        onSend={(text) => sendMessage(chatId, text)}
      />
    </div>
  )
}
```

- [ ] **Step 6: Wire ChatView into AgentsPanel**

In `packages/ide/src/panels/agents/agents-panel.tsx`, replace the chat-view placeholder:

```tsx
        {active?.kind === "chat" && (
          <div className="p-4 text-sm text-muted-foreground">
            Chat view — Task 7 will replace this. Chat id: {active.id}
          </div>
        )}
```

With:

```tsx
        {active?.kind === "chat" && <ChatView chatId={active.id} />}
```

Add the import:

```tsx
import { ChatView } from "./chat-view"
```

- [ ] **Step 7: Run tests, confirm pass**

```
pnpm --filter @darrylondil/lorien-ide test -- chat-view.test
```

Expected: 5 ChatView tests pass.

- [ ] **Step 8: Commit**

```
git add packages/ide/src/panels/agents/chat-view.tsx packages/ide/src/panels/agents/chat-view.test.tsx packages/ide/src/panels/agents/input-bar.tsx packages/ide/src/panels/agents/agents-panel.tsx packages/ide/src/store/agent-chats.ts
git commit -m "feat(ide): ChatView + InputBar — placeholder rendering, message send wiring"
```

---

## Task 8: Card components

Five real card components replacing the placeholder row. `AssistantText` uses `react-markdown`. Tool cards have distinct compact layouts.

**Files:**
- Create: `packages/ide/src/panels/agents/cards.tsx`
- Create: `packages/ide/src/panels/agents/cards.test.tsx`
- Modify: `packages/ide/src/panels/agents/chat-view.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/ide/src/panels/agents/cards.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  AssistantText,
  AssistantError,
  ToolUseRead,
  ToolUseEdit,
  ToolUseBash,
  UserMessage,
} from "./cards"

describe("cards", () => {
  it("AssistantText renders markdown", () => {
    render(<AssistantText text="Hello **world**" />)
    expect(screen.getByText("world").tagName).toBe("STRONG")
  })

  it("UserMessage shows the user's text with a 'You' label", () => {
    render(<UserMessage text="do the thing" />)
    expect(screen.getByText(/do the thing/)).toBeInTheDocument()
    expect(screen.getByText(/You/)).toBeInTheDocument()
  })

  it("ToolUseRead shows the file path", () => {
    render(<ToolUseRead path="nodes/users/save-user.ts" />)
    expect(screen.getByText("nodes/users/save-user.ts")).toBeInTheDocument()
  })

  it("ToolUseEdit shows path and a 'view diff' button", () => {
    render(<ToolUseEdit path="nodes/save-user.ts" />)
    expect(screen.getByText("nodes/save-user.ts")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /view diff/i })).toBeInTheDocument()
  })

  it("ToolUseBash shows the command", () => {
    render(<ToolUseBash command="pnpm test" />)
    expect(screen.getByText(/pnpm test/)).toBeInTheDocument()
  })

  it("AssistantError shows the message", () => {
    render(<AssistantError message="Claude CLI not installed" />)
    expect(screen.getByText(/Claude CLI not installed/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, expect failure**

```
pnpm --filter @darrylondil/lorien-ide test -- cards.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement cards**

Create `packages/ide/src/panels/agents/cards.tsx`:

```tsx
import { AlertCircle, FileEdit, FileText, Terminal, User } from "lucide-react"
import Markdown from "react-markdown"

export function UserMessage({ text }: { text: string }): React.ReactElement {
  return (
    <div className="flex gap-2 rounded-md bg-muted/30 px-2 py-1.5">
      <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          You
        </div>
        <div className="whitespace-pre-wrap text-xs">{text}</div>
      </div>
    </div>
  )
}

export function AssistantText({ text }: { text: string }): React.ReactElement {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed">
      <Markdown>{text}</Markdown>
    </div>
  )
}

export function ToolUseRead({ path }: { path: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <FileText className="h-3 w-3" />
      <span>Read</span>
      <code className="rounded bg-muted/40 px-1 font-mono">{path}</code>
    </div>
  )
}

interface ToolUseEditProps {
  path: string
}

export function ToolUseEdit({ path }: ToolUseEditProps): React.ReactElement {
  return (
    <div className="flex items-center gap-2 rounded-sm bg-muted/30 px-2 py-1 text-xs">
      <FileEdit className="h-3 w-3 text-foreground" />
      <span>Edited</span>
      <code className="rounded bg-muted/40 px-1 font-mono">{path}</code>
      <button
        type="button"
        className="ml-auto rounded-sm border border-border bg-background px-2 py-0.5 text-[10px] hover:bg-accent"
        onClick={() => {
          // Diff viewer integration deferred to a follow-up.
          console.info("[lorien] view diff not implemented yet:", path)
        }}
      >
        view diff
      </button>
    </div>
  )
}

interface ToolUseBashProps {
  command: string
  exitCode?: number
}

export function ToolUseBash({
  command,
  exitCode,
}: ToolUseBashProps): React.ReactElement {
  return (
    <div className="flex items-center gap-2 rounded-sm bg-muted/30 px-2 py-1 text-xs">
      <Terminal className="h-3 w-3" />
      <code className="flex-1 truncate font-mono text-foreground">{command}</code>
      {exitCode !== undefined && (
        <span
          className={
            exitCode === 0 ? "text-emerald-600" : "text-destructive"
          }
        >
          exit {exitCode}
        </span>
      )}
    </div>
  )
}

export function AssistantError({
  message,
}: {
  message: string
}): React.ReactElement {
  return (
    <div className="flex items-start gap-2 rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="flex-1">{message}</div>
    </div>
  )
}
```

Note on the `prose` classes used by `AssistantText`: these come from `@tailwindcss/typography`. If the IDE's Tailwind config doesn't already include the typography plugin, react-markdown still renders fine without those classes — the text will just be unstyled `<p>`/`<strong>`/etc. Acceptable for v1; the test only checks structural rendering, not styling.

- [ ] **Step 4: Replace the placeholder row in `ChatView` with real cards**

Edit `packages/ide/src/panels/agents/chat-view.tsx`. Replace this block:

```tsx
        {tab.events.map((event, i) => (
          <div
            key={i}
            data-testid="agent-event-row"
            className="mb-2 text-xs text-foreground"
          >
            <span className="font-mono text-muted-foreground">[{event.kind}]</span>{" "}
            {/* Real cards land in Task 8. */}
            {event.kind === "assistant_text" || event.kind === "user_message"
              ? event.text
              : null}
          </div>
        ))}
```

With:

```tsx
        {tab.events.map((event, i) => (
          <div key={i} data-testid="agent-event-row" className="mb-2">
            <EventRow event={event} />
          </div>
        ))}
```

And add this helper above `ChatView` in the same file:

```tsx
import {
  AssistantError,
  AssistantText,
  ToolUseBash,
  ToolUseEdit,
  ToolUseRead,
  UserMessage,
} from "./cards"
import type { AgentEvent } from "@/store/agent-chats"

function EventRow({ event }: { event: AgentEvent }): React.ReactElement | null {
  switch (event.kind) {
    case "user_message":
      return <UserMessage text={event.text} />
    case "assistant_text":
      return <AssistantText text={event.text} />
    case "tool_use": {
      const input = (event.input ?? {}) as Record<string, unknown>
      const path = typeof input.path === "string" ? input.path : ""
      const command =
        typeof input.command === "string" ? input.command : ""
      if (event.tool === "Read" || event.tool === "Grep") {
        return <ToolUseRead path={path || event.tool} />
      }
      if (event.tool === "Edit" || event.tool === "Write") {
        return <ToolUseEdit path={path} />
      }
      if (event.tool === "Bash") {
        return <ToolUseBash command={command} />
      }
      return (
        <div className="text-xs text-muted-foreground">
          tool: {event.tool}
        </div>
      )
    }
    case "tool_result":
      // Result events arrive after the tool_use card already exists. v1 doesn't
      // render a separate row for results — the tool_use card stays as the
      // visible artifact. Future versions could fold the summary back into it.
      return null
    case "turn_done":
      return null
    default:
      return null
  }
}
```

Remove the existing `// Real cards land in Task 8` placeholder cleanup.

- [ ] **Step 5: Run tests, confirm pass**

```
pnpm --filter @darrylondil/lorien-ide test
```

Expected: all tests pass — the `agent-event-row` test from Task 7 still passes (the `data-testid` is still present), plus 6 new card tests.

- [ ] **Step 6: Commit**

```
git add packages/ide/src/panels/agents/cards.tsx packages/ide/src/panels/agents/cards.test.tsx packages/ide/src/panels/agents/chat-view.tsx
git commit -m "feat(ide): chat event cards — AssistantText, ToolUseRead/Edit/Bash, AssistantError"
```

---

## Task 9: WebSocket client + store integration

Replace the `startClaudeChat` / `sendMessage` / `cancelTurn` stubs with real WS-backed implementations. The store owns a single WebSocket; reconnect with backoff; on reconnect, re-issue `open_chat` for the active chat and re-fetch its transcript via REST.

**Files:**
- Modify: `packages/ide/src/store/agent-chats.ts`
- Modify: `packages/ide/src/store/agent-chats.test.ts` (add WS-mock tests)

- [ ] **Step 1: Append WS-integration tests**

Append to `packages/ide/src/store/agent-chats.test.ts` (after the existing describe):

```ts
import type { AvailabilityResponse } from "./agent-chats.js"

describe("useAgentChats WebSocket integration", () => {
  let constructed: MockWebSocket[]

  class MockWebSocket {
    static OPEN = 1
    static CLOSED = 3
    // Mirror real WebSocket: constants are accessible on instances too.
    readonly OPEN = MockWebSocket.OPEN
    readonly CLOSED = MockWebSocket.CLOSED
    readyState = MockWebSocket.OPEN
    listeners: Record<string, ((e: unknown) => void)[]> = {}
    sent: string[] = []

    constructor(public url: string) {
      constructed.push(this)
      // Fire open synchronously in microtask
      queueMicrotask(() => this.fire("open", {}))
    }
    addEventListener(type: string, cb: (e: unknown) => void): void {
      ;(this.listeners[type] ??= []).push(cb)
    }
    removeEventListener(type: string, cb: (e: unknown) => void): void {
      this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== cb)
    }
    send(data: string): void {
      this.sent.push(data)
    }
    close(): void {
      this.readyState = MockWebSocket.CLOSED
      this.fire("close", {})
    }
    fire(type: string, ev: unknown): void {
      for (const cb of this.listeners[type] ?? []) cb(ev)
    }
    pushMessage(payload: object): void {
      this.fire("message", { data: JSON.stringify(payload) })
    }
  }

  beforeEach(() => {
    reset()
    constructed = []
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useAgentChats.getState().disconnect()
  })

  it("connect() opens a WebSocket once", async () => {
    useAgentChats.getState().connect()
    expect(constructed).toHaveLength(1)
    expect(constructed[0]!.url).toBe("ws://localhost:3000/__lorien/agents/ws")
    useAgentChats.getState().connect()
    // Idempotent — no new socket
    expect(constructed).toHaveLength(1)
  })

  it("startClaudeChat sends a new_chat message", async () => {
    useAgentChats.getState().connect()
    await Promise.resolve() // let microtask fire 'open'
    const pickerId = useAgentChats.getState().newChat()
    useAgentChats.getState().startClaudeChat(pickerId)
    const sent = constructed[0]!.sent
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]!)).toEqual({ type: "new_chat", agent: "claude" })
  })

  it("chat_created server message upgrades the picker tab", async () => {
    useAgentChats.getState().connect()
    await Promise.resolve()
    const pickerId = useAgentChats.getState().newChat()
    useAgentChats.getState().startClaudeChat(pickerId)
    constructed[0]!.pushMessage({ type: "chat_created", chatId: "c-new" })
    const s = useAgentChats.getState()
    expect(s.chats["c-new"]?.kind).toBe("chat")
    expect(s.activeChatId).toBe("c-new")
  })

  it("event messages append to the chat", async () => {
    useAgentChats.getState().connect()
    await Promise.resolve()
    const pickerId = useAgentChats.getState().newChat()
    useAgentChats.getState().startClaudeChat(pickerId)
    constructed[0]!.pushMessage({ type: "chat_created", chatId: "c-evt" })
    constructed[0]!.pushMessage({
      type: "event",
      chatId: "c-evt",
      event: {
        kind: "assistant_text",
        text: "hi",
        turnId: "t1",
        at: "2026-05-21T00:00:00Z",
      },
    })
    const tab = useAgentChats.getState().chats["c-evt"]
    if (tab?.kind === "chat") {
      expect(tab.events).toHaveLength(1)
    } else {
      throw new Error("expected chat")
    }
  })

  it("agent_error sets the chat's error and clears turnInFlight", async () => {
    useAgentChats.getState().connect()
    await Promise.resolve()
    const pickerId = useAgentChats.getState().newChat()
    useAgentChats.getState().startClaudeChat(pickerId)
    constructed[0]!.pushMessage({ type: "chat_created", chatId: "c-err" })
    useAgentChats.getState().setTurnInFlight("c-err", true)
    constructed[0]!.pushMessage({
      type: "agent_error",
      chatId: "c-err",
      message: "Claude not signed in",
      recoverable: true,
    })
    const tab = useAgentChats.getState().chats["c-err"]
    if (tab?.kind === "chat") {
      expect(tab.error).toMatch(/not signed in/i)
      expect(tab.turnInFlight).toBe(false)
    }
  })

  it("sendMessage queues until WS open and then writes", async () => {
    useAgentChats.getState().connect()
    await Promise.resolve()
    const pickerId = useAgentChats.getState().newChat()
    useAgentChats.getState().startClaudeChat(pickerId)
    constructed[0]!.pushMessage({ type: "chat_created", chatId: "c-snd" })
    useAgentChats.getState().sendMessage("c-snd", "hi")
    const sentTypes = constructed[0]!.sent.map((s) => JSON.parse(s).type)
    expect(sentTypes).toEqual(["new_chat", "user"])
    // optimistic local user_message event:
    const tab = useAgentChats.getState().chats["c-snd"]
    if (tab?.kind === "chat") {
      expect(tab.events[0]?.kind).toBe("user_message")
    }
    expect(useAgentChats.getState().chats["c-snd"]?.kind).toBe("chat")
    // turnInFlight true after send
    if (tab?.kind === "chat") {
      expect(tab.turnInFlight).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run, expect failure**

```
pnpm --filter @darrylondil/lorien-ide test -- agent-chats.test
```

Expected: original 9 tests still pass; new 6 WS tests fail because `connect`, `disconnect`, real `startClaudeChat`, real `sendMessage` aren't implemented.

- [ ] **Step 3: Implement WS integration**

Replace `packages/ide/src/store/agent-chats.ts` entirely with this version (it builds on Task 4's version, adding the WS layer):

```ts
import { create } from "zustand"
import { restBase, wsUrl } from "@/lib/api"

export type AgentName = "claude" | "codex"

export type ToolKind = "Read" | "Edit" | "Write" | "Bash" | "Grep" | "Other"

export type AgentEvent =
  | { kind: "user_message"; text: string; at: string }
  | { kind: "assistant_text"; text: string; turnId: string; at: string }
  | {
      kind: "tool_use"
      toolUseId: string
      tool: ToolKind
      input: unknown
      status: "started" | "completed" | "denied" | "pending_approval"
      at: string
    }
  | { kind: "tool_result"; toolUseId: string; ok: boolean; summary?: string; at: string }
  | {
      kind: "turn_done"
      turnId: string
      usage?: { inputTokens: number; outputTokens: number }
      at: string
    }

export interface AgentAvailability {
  installed: boolean
  version?: string
  authed?: boolean
}

export interface AvailabilityResponse {
  claude: AgentAvailability
  codex: AgentAvailability
}

interface PickerTab {
  kind: "picker"
  id: string
}

interface ChatTab {
  kind: "chat"
  id: string
  agent: AgentName
  title: string
  events: AgentEvent[]
  turnInFlight: boolean
  error: string | null
}

type Tab = PickerTab | ChatTab

type ServerMsg =
  | { type: "chat_created"; chatId: string }
  | { type: "event"; chatId: string; event: AgentEvent }
  | { type: "agent_error"; chatId: string; message: string; recoverable: boolean }
  | { type: "chat_closed"; chatId: string; reason: "subprocess_exit" | "user_cancel" }

interface AgentChatsState {
  chats: Record<string, Tab>
  order: string[]
  activeChatId: string | null
  availability: AvailabilityResponse | null

  newChat(): string
  setActive(id: string | null): void
  closeTab(id: string): void
  setAvailability(av: AvailabilityResponse): void
  setChatCreated(pickerId: string, realId: string, agent: AgentName): void
  appendEvent(chatId: string, event: AgentEvent): void
  setError(chatId: string, error: string | null): void
  setTurnInFlight(chatId: string, inFlight: boolean): void

  // WS layer
  connect(): void
  disconnect(): void
  startClaudeChat(pickerId: string): void
  sendMessage(chatId: string, text: string): void
  cancelTurn(chatId: string): void

  // REST
  hydrate(): Promise<void>
}

let pickerCounter = 0

// WS state is held outside the store to avoid serializing it via setState.
interface WsContext {
  socket: WebSocket | null
  pickerWaitingForId: string | null
  reconnectDelay: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  closed: boolean
}

const ws: WsContext = {
  socket: null,
  pickerWaitingForId: null,
  reconnectDelay: 1000,
  reconnectTimer: null,
  closed: false,
}

export const useAgentChats = create<AgentChatsState>((set, get) => {
  function onMessage(raw: string): void {
    let msg: ServerMsg
    try {
      msg = JSON.parse(raw) as ServerMsg
    } catch {
      return
    }
    if (msg.type === "chat_created") {
      const pickerId = ws.pickerWaitingForId
      ws.pickerWaitingForId = null
      if (pickerId) {
        get().setChatCreated(pickerId, msg.chatId, "claude")
      }
      return
    }
    if (msg.type === "event") {
      get().appendEvent(msg.chatId, msg.event)
      return
    }
    if (msg.type === "agent_error") {
      get().setError(msg.chatId, msg.message)
      get().setTurnInFlight(msg.chatId, false)
      return
    }
    if (msg.type === "chat_closed") {
      get().setTurnInFlight(msg.chatId, false)
      return
    }
  }

  function attachSocket(s: WebSocket): void {
    s.addEventListener("message", (e: unknown) => {
      const data = (e as { data: string }).data
      onMessage(data)
    })
    s.addEventListener("close", () => {
      ws.socket = null
      if (ws.closed) return
      // Backoff reconnect
      ws.reconnectTimer = setTimeout(() => {
        ws.reconnectDelay = Math.min(ws.reconnectDelay * 2, 30_000)
        get().connect()
      }, ws.reconnectDelay)
    })
    s.addEventListener("open", () => {
      ws.reconnectDelay = 1000
      // Re-subscribe to active chat (no replay in v1 — re-fetch via REST).
      const active = get().activeChatId
      const tab = active ? get().chats[active] : undefined
      if (tab && tab.kind === "chat") {
        try {
          s.send(JSON.stringify({ type: "open_chat", chatId: tab.id }))
        } catch {
          /* ignore — connection just opened */
        }
        // Re-fetch transcript to recover any missed events
        void fetchTranscript(tab.id)
      }
    })
  }

  async function fetchTranscript(chatId: string): Promise<void> {
    try {
      const res = await fetch(`${restBase()}/__lorien/agents/chats/${chatId}`)
      if (!res.ok) return
      const t = (await res.json()) as {
        id: string
        agent: AgentName
        title: string
        events: AgentEvent[]
      }
      set((s) => {
        const tab = s.chats[chatId]
        if (!tab || tab.kind !== "chat") return s
        return {
          chats: {
            ...s.chats,
            [chatId]: { ...tab, events: t.events, title: t.title },
          },
        }
      })
    } catch {
      /* swallow */
    }
  }

  function safeSend(payload: object): void {
    if (ws.socket && ws.socket.readyState === ws.socket.OPEN) {
      ws.socket.send(JSON.stringify(payload))
    }
    // If the socket isn't open, we drop. Reconnect will not replay user
    // messages — UX hardens in a follow-up. For v1, the button shouldn't
    // be clickable when WS is disconnected (ChatView checks turnInFlight).
  }

  return {
    chats: {},
    order: [],
    activeChatId: null,
    availability: null,

    newChat() {
      pickerCounter += 1
      const id = `picker-${Date.now()}-${pickerCounter}`
      set((s) => ({
        chats: { ...s.chats, [id]: { kind: "picker", id } satisfies PickerTab },
        order: [...s.order, id],
        activeChatId: id,
      }))
      return id
    },

    setActive(id) {
      set({ activeChatId: id })
    },

    closeTab(id) {
      set((s) => {
        const { [id]: _drop, ...rest } = s.chats
        const order = s.order.filter((x) => x !== id)
        let active = s.activeChatId
        if (active === id) {
          const idx = s.order.indexOf(id)
          active = order[Math.max(0, idx - 1)] ?? order[0] ?? null
        }
        return { chats: rest, order, activeChatId: active }
      })
    },

    setAvailability(av) {
      set({ availability: av })
    },

    setChatCreated(pickerId, realId, agent) {
      set((s) => {
        const { [pickerId]: _drop, ...rest } = s.chats
        const chatTab: ChatTab = {
          kind: "chat",
          id: realId,
          agent,
          title: "untitled",
          events: [],
          turnInFlight: false,
          error: null,
        }
        const order = s.order.map((x) => (x === pickerId ? realId : x))
        return {
          chats: { ...rest, [realId]: chatTab },
          order,
          activeChatId: s.activeChatId === pickerId ? realId : s.activeChatId,
        }
      })
    },

    appendEvent(chatId, event) {
      set((s) => {
        const tab = s.chats[chatId]
        if (!tab || tab.kind !== "chat") return s
        let title = tab.title
        if (title === "untitled" && event.kind === "user_message") {
          title = event.text.slice(0, 60)
        }
        const updated: ChatTab = {
          ...tab,
          events: [...tab.events, event],
          title,
          turnInFlight:
            event.kind === "turn_done" ? false : tab.turnInFlight,
        }
        return { chats: { ...s.chats, [chatId]: updated } }
      })
    },

    setError(chatId, error) {
      set((s) => {
        const tab = s.chats[chatId]
        if (!tab || tab.kind !== "chat") return s
        return { chats: { ...s.chats, [chatId]: { ...tab, error } } }
      })
    },

    setTurnInFlight(chatId, inFlight) {
      set((s) => {
        const tab = s.chats[chatId]
        if (!tab || tab.kind !== "chat") return s
        return { chats: { ...s.chats, [chatId]: { ...tab, turnInFlight: inFlight } } }
      })
    },

    connect() {
      if (ws.socket) return
      ws.closed = false
      const s = new WebSocket(wsUrl())
      ws.socket = s
      attachSocket(s)
    },

    disconnect() {
      ws.closed = true
      if (ws.reconnectTimer) {
        clearTimeout(ws.reconnectTimer)
        ws.reconnectTimer = null
      }
      ws.socket?.close()
      ws.socket = null
    },

    startClaudeChat(pickerId) {
      // The next `chat_created` message is routed to upgrade this picker.
      ws.pickerWaitingForId = pickerId
      safeSend({ type: "new_chat", agent: "claude" })
    },

    sendMessage(chatId, text) {
      // Optimistic local append so the user sees their message immediately.
      const ev: AgentEvent = {
        kind: "user_message",
        text,
        at: new Date().toISOString(),
      }
      get().appendEvent(chatId, ev)
      get().setTurnInFlight(chatId, true)
      safeSend({ type: "user", chatId, text })
    },

    cancelTurn(chatId) {
      safeSend({ type: "cancel", chatId })
      get().setTurnInFlight(chatId, false)
    },

    async hydrate() {
      try {
        const res = await fetch(`${restBase()}/__lorien/agents/chats`)
        if (!res.ok) return
        const idx = (await res.json()) as {
          version: 1
          chats: Array<{
            id: string
            agent: AgentName
            title: string
            createdAt: string
            lastEventAt: string
          }>
        }
        set((s) => {
          const next: Record<string, Tab> = { ...s.chats }
          const order: string[] = [...s.order]
          for (const c of idx.chats) {
            if (next[c.id]) continue
            next[c.id] = {
              kind: "chat",
              id: c.id,
              agent: c.agent,
              title: c.title,
              events: [],
              turnInFlight: false,
              error: null,
            }
            order.push(c.id)
          }
          return { chats: next, order }
        })
      } catch {
        /* network failure during hydrate is non-fatal */
      }
    },
  }
})
```

- [ ] **Step 4: Hook `connect()` into the panel**

In `packages/ide/src/panels/agents/agents-panel.tsx`, update the `useEffect` to call `connect`:

```tsx
  useEffect(() => {
    void hydrate()
    connect()
    return () => {
      disconnect()
    }
  }, [hydrate])
```

And destructure `connect` + `disconnect` from the store at the top:

```tsx
  const connect = useAgentChats((s) => s.connect)
  const disconnect = useAgentChats((s) => s.disconnect)
```

- [ ] **Step 5: Run tests, confirm pass**

```
pnpm --filter @darrylondil/lorien-ide test
```

Expected: all tests pass (9 original store tests + 6 new WS tests + 5 picker + 5 chat-view + 6 cards + 4 api tests + existing IDE tests).

- [ ] **Step 6: Commit**

```
git add packages/ide/src/store/agent-chats.ts packages/ide/src/store/agent-chats.test.ts packages/ide/src/panels/agents/agents-panel.tsx
git commit -m "feat(ide): agent-chats WS client — connect, send, reconnect, error handling"
```

---

## Task 10: End-to-end smoke

Manual UI verification. The implementer fires up the IDE, opens the Agents tab, sees the picker, clicks Start Chat, and verifies the chat actually receives events.

**Files:** No code changes; operational only.

**Pre-requisites:**
- `claude` CLI installed and authed on the test machine. If not, the smoke validates the plumbing up to "chat_created → agent_error: subprocess exited" which is also a valid result.

- [ ] **Step 1: Build runtime + IDE**

```
pnpm --filter @darrylondil/lorien-runtime build
pnpm --filter @darrylondil/lorien-ide build
```

Both should exit 0.

- [ ] **Step 2: Scaffold a smoke project + install + start broker**

```powershell
$repo = (Get-Location).Path
$tmp = Join-Path $env:TEMP "lorien-ide-smoke-$([guid]::NewGuid().ToString().Substring(0,8))"
New-Item -ItemType Directory -Path $tmp | Out-Null
Push-Location $tmp
node "$repo/packages/create-lorien-api/dist/cli.js" ide-app --skip-install
Push-Location ide-app
pnpm install
Start-Process -PassThru -NoNewWindow -RedirectStandardOutput "server.log" -FilePath "npx" -ArgumentList "tsx", "src/server.ts"
Pop-Location
Pop-Location
Start-Sleep 3
Get-Content "$tmp/ide-app/server.log"
```

Expected: server log shows `lorien-api listening on http://localhost:3000`.

- [ ] **Step 3: Start the IDE dev server**

In a separate terminal (or background):

```
pnpm --filter @darrylondil/lorien-ide dev
```

Expected: Vite starts on its default port (likely 5173). Note the URL.

- [ ] **Step 4: Open the IDE in a browser**

Navigate to the URL from Step 3 (e.g. `http://localhost:5173`).

Verify:
- [ ] The Agents tab is visible in the right tab group, next to Inspector.
- [ ] Inspector is the default-visible tab (Agents not active until clicked).
- [ ] Click the Agents tab. Empty state appears: "Chat with an AI agent to edit workflows and nodes in this project."

- [ ] **Step 5: Start a chat**

- [ ] Click "Start your first chat" → AgentPicker appears with Claude + Codex cards.
- [ ] Claude card shows "Installed (v…)" if claude is on PATH; otherwise "Not installed → install instructions".
- [ ] Codex card shows "Coming soon".
- [ ] Click "Start chat" on Claude → picker tab upgrades to a chat tab named "untitled". InputBar appears.

- [ ] **Step 6: Send a message**

- [ ] Type "List the files under nodes/" into the input bar, hit Enter.
- [ ] The chat shows your `UserMessage` immediately (optimistic append).
- [ ] Within a few seconds, `assistant_text` cards stream in. If Claude reads the project structure, `ToolUseRead` cards appear.
- [ ] The tab title updates to "List the files under nodes/" (truncated to 60 chars).

If `claude` is NOT installed:
- [ ] The chat receives `agent_error: "The agent CLI exited without producing any output…"` rendered as an `AssistantError` card. This proves Plan B's `agent_error`-before-`chat_closed` UX fix lands correctly.

- [ ] **Step 7: Tear down**

```powershell
Stop-Process -Name node -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $tmp
```

- [ ] **Step 8: No commit**

Operational only.

---

## Done criteria

- [ ] `pnpm --filter @darrylondil/lorien-ide test` — all green.
- [ ] `pnpm --filter @darrylondil/lorien-ide typecheck` — clean.
- [ ] `pnpm --filter @darrylondil/lorien-ide build` — clean.
- [ ] Smoke (Task 10) demonstrates end-to-end picker → chat → events with a real or unavailable Claude CLI.
- [ ] 9 commits on the branch (one per task 1–9; task 10 is operational).

---

## What this plan does NOT do (deferred)

- **Monaco-based input bar** — uses plain `<textarea>` for v1.
- **Real "view diff" integration** — button is rendered but no-ops + logs.
- **Codex chats** — picker shows "Coming soon"; never sends `new_chat agent: "codex"`.
- **WS replay-on-reconnect** — uses REST re-fetch instead.
- **Per-message timestamps** in the UI.
- **Token usage HUD** from `turn_done` events.
- **Shell approval cards** — Plan B uses `bypassPermissions`, so nothing to approve.
- **Slash commands** in chat input.
- **Persistent chat list ordering** independent of broker's `lastEventAt` sort.
