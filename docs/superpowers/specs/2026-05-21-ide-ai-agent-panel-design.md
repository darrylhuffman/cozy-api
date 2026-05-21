# IDE AI Agent Panel — design

**Date:** 2026-05-21
**Subsystem:** new — sits across `@darrylondil/lorien-runtime`, `@darrylondil/lorien-ide`, and `create-lorien-api`
**Status:** brainstorm complete, ready for implementation planning

---

## 1. Vision

Bring a first-class AI authoring surface into the lorien-api IDE that uses **whichever CLI agent the user is already paying for** — Claude Code or Codex — without the lorien project taking on its own API keys, billing, or model abstraction. The IDE becomes a thin coordinator over the user's local CLI subprocess. Agents read and edit `.workflow` / node files directly; the lorien-specific knowledge they need to do this well is shipped as a skill artifact that lives in the user's project.

### v1 scope

- A new **Agents** dockview pane in the IDE.
- A multi-chat workflow inside the pane (sub-tab strip with a `+` new-chat button, agent picker on new-chat, in-place transition to chat view).
- A **local subprocess bridge** in `lorien dev` that spawns `claude -p` or `codex` per chat, streams events to the browser over WebSocket, and persists transcripts to `.lorien/chats/`.
- A **skill artifact** (`SKILL.md` + `AGENTS.md`) shipped by `@darrylondil/lorien-runtime` and installed into projects by `create-lorien-api`. The skill documents the workflow / node / config contract so agents author lorien content correctly.
- Auto-accept file edits, inline approval for shell commands.
- Chat persistence on disk; chats survive reload; CLI session resume via the agent's native `--resume`.

### v1 non-goals

- No API-key path. Users must have the CLI installed and authed; lorien does not proxy a hosted model.
- No Electron / desktop shell. Bridge lives in `lorien dev` (Node + WebSocket).
- No multi-project workspace. One `lorien dev` instance = one project.
- No in-chat slash commands (`/clear`, `/compact`, agent-switching mid-chat).
- No image / attachment input.
- No telemetry on agent usage.
- No custom per-chat system prompt; the skill is the only project-specific injection.
- No `lorien sync-skill` command in v1 — install-time write only.

---

## 2. Decisions (locked in during brainstorm)

| # | Topic | Direction |
|---|---|---|
| D1 | Bridge architecture | `lorien dev` WebSocket → spawns user-installed `claude -p` / `codex` subprocess per chat. Inherits user's CLI auth. |
| D2 | Skill format | Both `.claude/skills/lorien-api/SKILL.md` (Claude auto-loads) and `AGENTS.md` (Codex / Cursor / Copilot read on demand). Same body. |
| D3 | Permissions | `--permission-mode acceptEdits`. File Read / Edit / Write happen immediately. Shell commands prompt inline in chat. |
| D4 | Persistence | `.lorien/chats/{id}.json` per chat + `.lorien/chats/index.json` index. `.lorien/` is gitignored. Resume via the agent's `--resume <id>`. |
| D5 | Layout | Agents added to the inspector tab group on the right; Inspector remains the default-visible tab in the group. |

---

## 3. Architecture

The feature crosses three packages, with one tightly-bounded module added to each. Each unit has one purpose and exposes a narrow interface.

### 3.1 `@darrylondil/lorien-runtime` — agent broker

Lives in `packages/runtime/src/agent-broker/`. Mounted onto the Hono app returned by `startLorienServer()`.

**Public surface:**

```ts
// packages/runtime/src/agent-broker/index.ts
export function mountAgentBroker(app: Hono, opts: { projectRoot: string }): void
```

**Endpoints:**

| Path | Protocol | Purpose |
|---|---|---|
| `GET /__lorien/agents/availability` | REST | Returns `{ claude: { installed, version?, authed? }, codex: { installed, version?, authed? } }`. Probed at request time via `which` + a cheap `--version`-style call. Cached for 30s. |
| `GET /__lorien/agents/chats` | REST | Returns the index (`.lorien/chats/index.json`) — chat list with id, agent, title, timestamps. |
| `GET /__lorien/agents/chats/:id` | REST | Returns one chat's full transcript. |
| `WS  /__lorien/agents/ws` | WebSocket | Live event stream; protocol in §4. |

**Internal modules:**

- `subprocess.ts` — spawns a CLI as a child process with `cwd = projectRoot`, given an agent name + chat ID + initial prompt. Returns an `AsyncIterable<AgentEvent>` (parsed) + a `send(input: string)` to write to stdin + a `kill()` method. Knows the per-agent invocation: `claude -p --output-format stream-json --resume <id> --permission-mode acceptEdits` or the codex equivalent. Streams from stdout, buffers stderr.
- `normalize.ts` — converts each agent's native stream format into the shared `AgentEvent` union. Two narrow adapters: `normalizeClaude(line) → AgentEvent[]`, `normalizeCodex(line) → AgentEvent[]`. Each is a pure function over a parsed JSON line — trivially unit-testable with recorded fixtures.
- `transcript.ts` — appends events to `.lorien/chats/{id}.json` atomically (write to `.tmp` + rename); updates `index.json` on chat creation and on each event. Read API: list, load.
- `permissions.ts` — handles shell-approval round trip: receives a `tool_use { tool: Bash, status: pending-approval }` from the subprocess, emits `shell_approval_requested` to all browser subscribers, awaits the first matching `approve_shell` message, then writes the approval back to the subprocess stdin.
- `server.ts` — the Hono mount + WebSocket handler. Owns the subscriber registry (chatId → set of WebSocket sessions). Owns the lifecycle of subprocess instances (lazy spawn on first user message; kill on chat close or all-subscribers-disconnected).
- `availability.ts` — `which` + version probe per agent, with 30s cache.

**Security:** broker rejects WebSocket upgrades whose origin is non-loopback. Same posture as the rest of `lorien dev`.

### 3.2 `@darrylondil/lorien-ide` — Agents panel

New files under `packages/ide/src/panels/agents/`:

- `agents-panel.tsx` — top-level pane; reads chat list from store; renders sub-tab strip + active chat.
- `sub-tab-strip.tsx` — chat tabs + `+` new button. Horizontal scroll on overflow.
- `agent-picker.tsx` — new-chat initial state. Two agent cards, install-link fallback, "Start chat" button. Reads availability via `useAgentAvailability()`.
- `chat-view.tsx` — message stream + input bar. Subscribes to the chat's event stream via the store.
- `cards/` — `assistant-text.tsx`, `tool-use-edit.tsx`, `tool-use-read.tsx`, `tool-use-bash.tsx`, `tool-use-bash-approval.tsx`, `assistant-error.tsx`. Each ~30 lines, one card type per file.
- `input-bar.tsx` — Monaco mini-editor wrapper for chat input.

**Store** — `packages/ide/src/store/agent-chats.ts`:

```ts
type AgentChat = {
  id: string
  agent: "claude" | "codex" | null   // null until picker resolved
  title: string                       // "untitled" until first user message
  events: AgentEvent[]
  turnInFlight: boolean
  error?: string
}

type AgentChatsState = {
  chats: Record<string, AgentChat>
  order: string[]                     // tab order
  activeChatId: string | null
  availability: AvailabilityResponse | null
  // …actions:
  newChat(): string                   // creates a chat in picker state, returns id
  pickAgent(chatId, agent): void      // transitions to chat state
  sendMessage(chatId, text): void
  approveShell(chatId, toolUseId, allow): void
  cancelTurn(chatId): void
  closeChat(chatId): void
  setActive(chatId): void
}
```

**Wiring:** registered in `packages/ide/src/layout/default-layout.ts`:

```ts
export type PaneId = "files" | "workflow" | "code" | "inspector" | "agents"
export const PANE_IDS = ["files", "workflow", "code", "inspector", "agents"] as const
export const PANE_TITLES = {
  ...,
  agents: "Agents",
}
```

`buildDefaultLayout` adds the Agents panel with `position: { referencePanel: "inspector", direction: "within" }` *after* Inspector is added, then explicitly re-activates Inspector (`api.getPanel("inspector")?.api.setActive()`) so Inspector remains the default-visible tab — dockview otherwise activates the most recently added panel in a group.

`reopenPanel` for `agents` prefers to join Inspector's group when present; falls back to the right of the editor group.

### 3.3 `@darrylondil/lorien-runtime` (also) — skill artifact

- `packages/runtime/assets/agent-skill/SKILL.md` — single source of truth (frontmatter + body). Ships inside the published package; bundling strategy chosen at implementation time (options: inline as a TS template literal generated from the .md by a build step; or ship the .md inside `dist/` and read at runtime via `fs.readFile` relative to the package install location). The runtime `package.json` `files` field will need to include whatever directory the artifact ships in.
- `packages/runtime/src/skill.ts`:
  ```ts
  export const SKILL_MARKDOWN: string  // loaded via whichever strategy implementation picks
  export async function writeProjectSkill(projectRoot: string): Promise<{ claudePath: string; agentsPath: string }>
  ```
  `writeProjectSkill` creates `.claude/skills/lorien-api/SKILL.md` (verbatim) and `AGENTS.md` (frontmatter stripped) and idempotently appends `.lorien/` to `.gitignore`.

### 3.4 `create-lorien-api`

One change: after scaffolding, call `writeProjectSkill(newProjectRoot)`. No other surface area.

---

## 4. Data flow & protocol

### 4.1 Lifecycle of a chat message

```
Browser                       Broker                          CLI subprocess
   │                            │                                   │
   │  ws: user{chatId, text}    │                                   │
   ├───────────────────────────▶│                                   │
   │                            │  if no live subprocess:           │
   │                            │  spawn claude -p --resume <id>    │
   │                            ├──────────────────────────────────▶│
   │                            │                                   │
   │                            │◀── stream-json events ────────────┤
   │  ws: event{...}            │   (normalize → AgentEvent)        │
   │◀───────────────────────────┤   (atomic append to transcript)   │
   │                            │                                   │
   │  (render cards as events   │                                   │
   │   stream in)               │                                   │
```

### 4.2 WebSocket message union

```ts
// browser → broker
type ClientMsg =
  | { type: "user"; chatId: string; text: string }
  | { type: "approve_shell"; chatId: string; toolUseId: string; allow: boolean }
  | { type: "cancel"; chatId: string }
  | { type: "open_chat"; chatId: string }                          // subscribe to live events
  | { type: "new_chat"; agent: "claude" | "codex" }                // server assigns id

// broker → browser
type ServerMsg =
  | { type: "chat_created"; chatId: string }
  | { type: "event"; chatId: string; eventSeq: number; event: AgentEvent }
  | { type: "shell_approval_requested"; chatId: string; toolUseId: string; command: string }
  | { type: "agent_error"; chatId: string; message: string; recoverable: boolean }
  | { type: "chat_closed"; chatId: string; reason: "subprocess_exit" | "user_cancel" }
  | { type: "replay"; chatId: string; since: number; events: { eventSeq: number; event: AgentEvent }[] }
```

`eventSeq` is a monotonically increasing per-chat counter. Browser tracks `lastSeen[chatId]`. On reconnect, browser sends `open_chat` with the last seen seq; broker responds with `replay` for any gap.

### 4.3 Normalized `AgentEvent` union

```ts
type AgentEvent =
  | { kind: "user_message"; text: string; at: string }
  | { kind: "assistant_text"; text: string; turnId: string; at: string }
  | { kind: "tool_use"; toolUseId: string; tool: ToolKind; input: unknown; status: "started" | "completed" | "denied" | "pending_approval"; at: string }
  | { kind: "tool_result"; toolUseId: string; ok: boolean; summary?: string; at: string }
  | { kind: "turn_done"; turnId: string; usage?: { inputTokens: number; outputTokens: number }; at: string }

type ToolKind = "Read" | "Edit" | "Write" | "Bash" | "Grep" | "Other"
```

### 4.4 Persistence layout

```
.lorien/                           # added to project-root .gitignore by writeProjectSkill
└── chats/
    ├── index.json
    ├── 0193a8b2-…json
    ├── 0193a8c5-…json
    └── .broken/                  # corrupted transcripts quarantined here
```

`index.json`:

```jsonc
{
  "version": 1,
  "chats": [
    { "id": "0193…", "agent": "claude", "title": "Refactor save-user", "createdAt": "…", "lastEventAt": "…" }
  ]
}
```

`{id}.json`:

```jsonc
{
  "id": "0193…",
  "agent": "claude",
  "createdAt": "…",
  "title": "Refactor save-user",
  "events": [ /* AgentEvent[] in order */ ]
}
```

### 4.5 File-edit visibility in the IDE

The agent runs in the project cwd and edits files via its own Read / Edit / Write tools — no special wiring. The IDE's existing file-watch / open-buffer-reload behavior is the path by which Workflow / Code panes see updates. The chat's `tool_use` Edit card is a UI affordance; clicking "view diff" opens the file in the Code pane and scrolls / highlights the change.

---

## 5. UI specification

### 5.1 Panel chrome (3 bands, top→bottom)

```
┌─ Agents (dockview tab in the right group) ──────────────┐
│ Refactor ✕ │ Email node ✕ │ + new                       │  sub-tab strip
├──────────────────────────────────────────────────────────┤
│   ● claude  I'll refactor save-user…                    │
│   ● claude  Edited nodes/users/save-user.ts             │
│            +12 −2  → view diff                          │  message stream
│   ● claude  Wants to run: pnpm test                     │
│            [Allow once] [Allow always] [Deny]           │
├──────────────────────────────────────────────────────────┤
│ Type a message…                                       ↵  │  input bar
└──────────────────────────────────────────────────────────┘
```

### 5.2 New-chat flow

Clicking `+` creates a new sub-tab whose initial state is the agent picker, not a chat. The picker is a two-card layout (Claude / Codex), each card reading from `/__lorien/agents/availability`:

- **Installed + authed:** "Logged in" line, primary "Start chat" button.
- **Installed + not authed:** "Sign in by running `claude` in a terminal"; "Start chat" disabled.
- **Not installed:** "Not installed → install instructions" link; "Start chat" disabled.

Picking transitions the same sub-tab in-place to the chat view. Tab title is `"untitled"` until the first user message arrives, then truncated first message (saved to the chat's `title`).

### 5.3 Card types

| Card | Content |
|---|---|
| `<AssistantText>` | Markdown rendered (uses `react-markdown` — new dep, lightweight). Text streams incrementally on `assistant_text` events. |
| `<ToolUseRead>` / `<ToolUseGrep>` | One-line ghost row: `↳ Read nodes/users/save-user.ts`. Non-interactive. |
| `<ToolUseEdit>` / `<ToolUseWrite>` | `● Edited <path>  +N −M  → view diff`. "view diff" opens the file in Code pane (or scrolls to it if open) and highlights the change. |
| `<ToolUseBashApproval>` | Command preview + `[Allow once] [Allow always] [Deny]`. Resolves to `<ToolUseBash>` on click. |
| `<ToolUseBash>` | Command + exit code; expand-to-reveal last 30 lines of stdout/stderr. |
| `<AssistantError>` | Red-ish row with title + message; used for `agent_error` and `chat_closed { subprocess_exit }`. Retry button on recoverable errors. |

All cards are left-aligned, monochrome (no chat-bubble styling) to fit the IDE rather than a chat app.

### 5.4 Input bar

- Monaco mini-editor (one editor instance per chat view; lazily mounted).
- `↵` sends; `shift+↵` newline; `esc` cancels the in-flight turn.
- Disabled while a turn is in flight, except `esc` cancel.

### 5.5 Empty state

Zero chats → centered "Start your first chat with an AI agent" CTA that calls `newChat()` (drops into picker).

### 5.6 Inspector coexistence

Inspector remains the default-visible tab in the right group. The Agents tab is a sibling; the user clicks it to switch. The empty-state CTA on first IDE launch does not auto-switch; users discover Agents by clicking its tab.

---

## 6. Skill artifact content

### 6.1 SKILL.md frontmatter

```markdown
---
name: lorien-api
description: Use when authoring or editing files in a lorien-api project — workflows (.workflow JSON dependency graphs), nodes (typed defineNode modules), or lorien.config.ts (service registry). Triggers on edits in workflows/, nodes/, or any file ending in .workflow.
---
```

### 6.2 Body sections (in order)

1. **What this project is.** 3 sentences. lorien-api, named-input JSON workflows, compile to plain TS via `lorien build`, deployed code has no runtime dep on lorien-api.
2. **Layout map.** Annotated tree of `workflows/`, `nodes/`, `lorien.config.ts`, `.lorien/` (do-not-edit).
3. **The node contract.** One canonical `defineNode` example with annotations + rules (one node per file, kebab-case filename, export default, never throw — return shaped errors).
4. **The .workflow file format.** Annotated example + rules (`in` keys match target schema, values are `<id>.<field>`, no cycles, `view` metadata regenerable as `null`).
5. **Authoring recipes.** Short blocks: "add a new node", "wire a node into a workflow", "add a service", "add an OpenAPI client".
6. **Verification.** `pnpm typecheck && pnpm test`; tests live next to nodes; `testWorkflow` / `traceWorkflow` from runtime.
7. **What NOT to do.** No runtime dep on lorien-api in user code; don't hand-edit `.lorien/`; don't introduce edges-array workflows; don't add error-handling middleware patterns.

### 6.3 AGENTS.md

Same body as SKILL.md, with frontmatter stripped. Generated by `writeProjectSkill`. Committed by users (not gitignored).

### 6.4 Versioning marker

HTML comment near top of SKILL.md: `<!-- lorien-skill-version: 1 -->`. Reserved for the future `lorien sync-skill` command (v1.1+).

---

## 7. Error / edge-case matrix

| Situation | Detection | Behavior |
|---|---|---|
| CLI not installed | `which` fails on availability probe | Picker card shows "Not installed"; "Start chat" disabled. No subprocess attempted. |
| CLI installed, not authed | First stream-json event is auth error | One-time card: "Sign in by running `claude` in a terminal". Subprocess killed; chat preserved; retry button. |
| Subprocess crashes mid-turn | exit ≠ 0 | Emit `chat_closed { subprocess_exit }`; surface last 5 stderr lines in an error card. Next user message respawns. |
| WS disconnect | `ws.onclose` browser-side | Exponential backoff reconnect (1s → 30s cap). Broker kills any in-flight subprocess on disconnect to avoid orphans. On reconnect, browser sends `open_chat` with last-seen seq; broker `replay`s gap. |
| Two browser tabs on same project | Same broker, same WS | Both subscribe; events fan out. Sending while a turn is in flight elsewhere → `agent_error { recoverable: true }`. |
| `.lorien/chats/{id}.json` corrupted | JSON parse fails | Quarantine to `.lorien/chats/.broken/{id}.{timestamp}.json`; one-time toast; carry on. |
| Agent edits a file with unsaved IDE buffer | Existing IDE concern | Out of scope for this spec; uses whatever conflict policy the IDE already has (or surfaces it as a separate item). |
| User opens IDE outside a lorien project | No `lorien.config.ts` at startup | Agents pane renders "Open a lorien project to use agents". No subprocess attempted. |
| `lorien dev` on a non-loopback host | Origin check on WS upgrade | Reject. Same posture as the rest of `lorien dev`. |
| Shell approval timeout (10 min idle) | Per-pending-approval timer | Auto-deny; emit `tool_result { ok: false, summary: "timed out" }`. Chat continues. |
| Long-running shell (`pnpm test:watch`) | Subprocess outlives turn | Killed when chat is closed or parent subprocess dies. No per-command timeout in v1. |

---

## 8. Testing strategy

### 8.1 Runtime layer

- Unit: `writeProjectSkill` — tmpdir, assert file contents, `.gitignore` idempotent append.
- Unit: stream-JSON normalizers (Claude + Codex). Fed committed fixture recordings; assert `AgentEvent` sequences.
- Unit: `transcript.ts` — atomic write, corrupted-file quarantine, index update.
- Integration: broker over WebSocket, with a **mock subprocess** (small Node script that emits canned stream-json from a fixture). Drive client messages, assert event delivery, persistence files, replay-on-reconnect.
- No tests against the real `claude` / `codex` binaries (CI portability).

### 8.2 IDE layer

- Component: `<ChatView>` with canned `AgentEvent[]` — assert rendered cards.
- Component: `<AgentPicker>` with mocked availability — assert disabled / install-link states.
- Store: `useAgentChats` — simulate full event stream, simulate WS disconnect + replay, assert state shape.
- Layout: `default-layout` test updated to assert Agents joins the right group with Inspector active.

### 8.3 Skill artifact

- Parse test: `SKILL_MARKDOWN` has valid frontmatter and a non-empty body.
- Strip test: AGENTS.md derivation produces a self-contained body.
- No semantic tests in v1 — skill quality verified by manual agent runs during dogfooding.

---

## 9. Implementation phases (sketch — full plan separate)

A reasonable ordering for the writing-plans skill to refine:

1. **Skill artifact + `writeProjectSkill`** — standalone, no UI dependency. Lets users benefit from the skill via CLI outside the IDE while the rest is built.
2. **Agent broker (runtime side)** — subprocess module + normalizer + transcript + REST availability endpoint, behind a unit-tested WebSocket protocol. No IDE consumer yet.
3. **Agents panel scaffolding** — pane registration, sub-tab strip, agent picker, empty state. Hits real availability endpoint. No real chat yet.
4. **Chat view + cards** — message stream + input bar + card types. Wired to the broker WebSocket. End-to-end first chat.
5. **Persistence + resume** — restore chats on IDE load; resume CLI session on next user message.
6. **Edge cases** — error states, WS replay, shell approval, corrupted transcript quarantine.

Phase 1 is genuinely shippable on its own; the rest are best shipped together at phase 6.

---

## 10. Open questions deferred to implementation planning

These don't change the architecture, but the writing-plans skill will need to resolve them:

- Exact Codex CLI invocation flags (we know the conceptual shape; need to confirm the equivalents of `-p`, `--output-format stream-json`, `--resume`, `--permission-mode acceptEdits`).
- WebSocket library choice (raw `ws` vs Hono's WS upgrade helpers vs another lib).
- React markdown renderer (`react-markdown` proposed; verify bundle weight vs alternatives).
- Whether the existing IDE has dirty-buffer / external-edit conflict policy already; if not, file a separate spec rather than absorbing it here.
- Whether `availability` probing on every page load is cheap enough or should be event-driven (filesystem watcher on PATH dirs is overkill).
