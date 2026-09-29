# IDE AI Agent — Plan B: Runtime Broker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local agent broker inside `@darrylondil/lorien-runtime` that spawns the user-installed Claude Code CLI per chat, streams normalized events to the browser over WebSocket, and persists transcripts to `.lorien/chats/`. End state: a `lorien dev` server can hold a WS chat with Claude Code from any client; the IDE (Plan C) plugs into this.

**Architecture:** New module `packages/runtime/src/agent-broker/` with focused files per responsibility (types, normalizer, transcript, availability, subprocess, subscribers, REST + WS server). Mounted into the user's Hono app via a single `attachAgentBroker({ app, server, projectRoot })` helper called after `@hono/node-server` boots. Uses the `ws` package directly (rather than `@hono/node-ws`) to keep the broker independently mountable on a stock Node `http.Server`. Claude Code is the only supported agent in this plan — Codex deferred to a follow-up.

**Tech Stack:** TypeScript ESM, vitest, `ws` (new dep), Node's `child_process` + `fs/promises`. No new runtime peer deps beyond what already exists.

**Spec reference:** `docs/superpowers/specs/2026-05-21-ide-ai-agent-panel-design.md` §3.1 (architecture), §4 (data flow), §7 (errors), §8.1 (testing).

---

## Scope, in and out

**In v1 of Plan B:**
- Claude Code subprocess driver (`claude -p --input-format stream-json --output-format stream-json --permission-mode bypassPermissions [--resume]`)
- Normalized event stream (assistant text, tool_use, tool_result, turn_done) from Claude's native format
- Transcript persistence at `.lorien/chats/{id}.json` + index file
- Atomic write + corrupted-file quarantine
- REST endpoints: availability, list chats, get chat
- WebSocket endpoint at `/__lorien/agents/ws` with the protocol from spec §4.2
- Multi-subscriber fan-out (multiple browser tabs can subscribe to one chat)
- Lazy subprocess spawn (deferred until first user message)
- Kill on cancel + on all-subscribers-disconnected
- Loopback-only WS upgrade guard

**Deferred to follow-up plans:**
- Shell approval round-trip UI (B uses `--permission-mode bypassPermissions` for now; spec'd inline approval UI lands when Plan C wires the chat surface)
- Codex normalizer (interface stubbed; `availability.codex.installed === false`)
- WS reconnect replay (`replay` server message + `eventSeq` gap detection) — browser falls back to REST-fetching the transcript on reconnect for now
- Per-chat title computation (use raw first-user-message text truncated to 60 chars)

These trade-offs let Plan B ship as one cohesive runtime layer that Plan C consumes.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `packages/runtime/src/agent-broker/types.ts` | Create | `AgentEvent`, `ClientMsg`, `ServerMsg`, `AgentName`, `AvailabilityResponse` discriminated unions. Pure types, no runtime code. |
| `packages/runtime/src/agent-broker/normalize-claude.ts` | Create | Pure `normalizeClaude(line: string): AgentEvent[]`. Parses Claude's stream-json line and emits zero or more normalized events. |
| `packages/runtime/src/agent-broker/normalize-claude.test.ts` | Create | Unit tests over committed fixtures. |
| `packages/runtime/src/agent-broker/__fixtures__/claude-stream.jsonl` | Create | Realistic Claude stream-json sample (5 lines: init, assistant text, tool_use, tool_result, result). |
| `packages/runtime/src/agent-broker/__fixtures__/mock-cli.ts` | Create | Tiny standalone Node script: reads stream-json from stdin, echoes a canned stream-json sequence to stdout. Used by subprocess driver tests. |
| `packages/runtime/src/agent-broker/transcript.ts` | Create | Atomic per-chat JSON append; index.json maintenance; corrupted-file quarantine into `.broken/`. |
| `packages/runtime/src/agent-broker/transcript.test.ts` | Create | Tmp-dir tests for create/append/load/list/quarantine. |
| `packages/runtime/src/agent-broker/availability.ts` | Create | `probeAvailability()` — `which`/`where` + version probe, 30s in-memory cache. |
| `packages/runtime/src/agent-broker/availability.test.ts` | Create | Tests with `PATH` overrides + injected exec. |
| `packages/runtime/src/agent-broker/subprocess.ts` | Create | `spawnClaude({ chatId, projectRoot, resumeSessionId? })` → `{ events: AsyncIterable, send(text), kill() }`. Wraps `child_process.spawn`. |
| `packages/runtime/src/agent-broker/subprocess.test.ts` | Create | Drive the mock-cli fixture and assert observable events. |
| `packages/runtime/src/agent-broker/subscribers.ts` | Create | `SubscriberRegistry`: map chatId → Set<WebSocket>. Methods: subscribe, unsubscribe, broadcast, isAnyOnline. |
| `packages/runtime/src/agent-broker/subscribers.test.ts` | Create | Pure unit tests with mock-shaped sockets. |
| `packages/runtime/src/agent-broker/server.ts` | Create | `mountAgentBroker` (REST) + `attachAgentBroker` (WS upgrade on http.Server). Connects all the above. |
| `packages/runtime/src/agent-broker/server.test.ts` | Create | End-to-end integration test: real Hono app + http server + ws client + mock-cli. |
| `packages/runtime/src/index.ts` | Modify | Export `attachAgentBroker`, types. |
| `packages/runtime/package.json` | Modify | Add `ws` dep + `@types/ws` devDep. |
| `packages/create-lorien-api/src/templates.ts` | Modify | Update `renderServerEntry` to call `attachAgentBroker`. |
| `packages/create-lorien-api/src/templates.test.ts` | Modify | Update server.ts template test. |

19 files. Net additions only; one runtime export added; one template updated. No deletions.

---

## Decisions locked in this plan

- **`ws` library, not `@hono/node-ws`.** `@hono/node-ws` is a thin wrapper that requires `injectWebSocket(server)` on the node server. Using `ws` directly with `noServer: true` + attaching to `httpServer.on('upgrade', …)` gives identical functionality with one fewer dep and a cleaner separation: the broker takes the http server as input and does its own upgrade handling. Easier to test.
- **`--permission-mode bypassPermissions` for v1.** Real-world users running `lorien dev` locally with their own files. Spec'd inline shell-approval cards land in Plan C alongside the chat UI. Documented as a known degradation in the plan; user-visible in commit log.
- **Lazy subprocess spawn.** The CLI process is created on the first `user` message, not on chat creation. Empty chats (new tabs with no message sent) consume no subprocess.
- **Subprocess lifecycle = chat lifecycle, capped by subscribers.** A subprocess dies when (a) the user sends `cancel`, (b) the subscriber set goes empty, or (c) the subprocess exits on its own. On the next `user` message after death, respawn with `--resume <sessionId>` if a session id was captured.
- **Loopback-only WS guard.** Reject `Upgrade` requests whose `Origin` header is missing or not in {`http://localhost:*`, `http://127.0.0.1:*`, `http://[::1]:*`}. Matches the existing `lorien dev` posture for dev-only endpoints.
- **No replay-on-reconnect in v1.** The `replay` server message + `eventSeq` numbering documented in spec §4.2 are not implemented. Browser reconnect = re-fetch the transcript via REST. Replay-on-WS lands in a follow-up.
- **`AgentName` is `"claude" | "codex"` everywhere**, even though only Claude is functional. Codex code paths return `installed: false` from availability and reject `new_chat` requests with `agent_error { recoverable: false }`.

---

## Task 1: Add the `ws` dependency to `@darrylondil/lorien-runtime`

Tiny dependency-adding task; no code. Sets up the rest of the broker.

**Files:**
- Modify: `packages/runtime/package.json`

- [ ] **Step 1: Look up the current latest stable `ws` and `@types/ws` versions**

Run from repo root:

```
pnpm view ws version
pnpm view @types/ws version
```

Record the major.minor versions (e.g. `8.18.0`, `8.5.13`). Use `^` ranges.

- [ ] **Step 2: Edit `packages/runtime/package.json`**

Add `dependencies` (create the field — the runtime currently has only `peerDependencies` and `devDependencies`) and add the matching devDeps for testing:

```jsonc
{
  "dependencies": {
    "ws": "^<version-from-step-1>"
  },
  "devDependencies": {
    // ... existing devDeps, alphabetical:
    "@hono/node-server": "^<latest>",   // for integration tests that need a real http server
    "@types/ws": "^<types-version-from-step-1>",
    "tsx": "^<latest>",                  // for spawning the mock-cli .ts fixture in subprocess tests
    // ... (keep existing hono, tsup, vitest, zod, etc.)
  }
}
```

For `@hono/node-server` and `tsx`, query npm for current latest:

```
pnpm view @hono/node-server version
pnpm view tsx version
```

Use the major.minor with `^`. Maintain alphabetical key order.

- [ ] **Step 3: Install**

```
pnpm install
```

Expected: install completes; no errors; `pnpm --filter @darrylondil/lorien-runtime test` still passes (the existing test suite is unaffected).

- [ ] **Step 4: Commit**

```
git add packages/runtime/package.json pnpm-lock.yaml
git commit -m "chore(runtime): add ws + integration-test deps for agent broker"
```

---

## Task 2: Core types for events and protocol

Define every shape used by later tasks. Pure types — no runtime code.

**Files:**
- Create: `packages/runtime/src/agent-broker/types.ts`
- Create: `packages/runtime/src/agent-broker/types.test-d.ts`

- [ ] **Step 1: Write the type-level test**

Create `packages/runtime/src/agent-broker/types.test-d.ts`:

```ts
import { expectTypeOf } from "vitest"
import type {
  AgentEvent,
  AgentName,
  AvailabilityResponse,
  ClientMsg,
  ServerMsg,
} from "./types.js"

// AgentName is a closed union of the two agents we plan to support.
expectTypeOf<AgentName>().toEqualTypeOf<"claude" | "codex">()

// AgentEvent is a discriminated union keyed by `kind`.
const userMsg: AgentEvent = {
  kind: "user_message",
  text: "hi",
  at: "2026-05-21T00:00:00Z",
}
const assistantText: AgentEvent = {
  kind: "assistant_text",
  text: "hello",
  turnId: "t1",
  at: "2026-05-21T00:00:00Z",
}
const toolUse: AgentEvent = {
  kind: "tool_use",
  toolUseId: "tu_1",
  tool: "Read",
  input: { path: "x" },
  status: "completed",
  at: "2026-05-21T00:00:00Z",
}
const toolResult: AgentEvent = {
  kind: "tool_result",
  toolUseId: "tu_1",
  ok: true,
  at: "2026-05-21T00:00:00Z",
}
const turnDone: AgentEvent = {
  kind: "turn_done",
  turnId: "t1",
  at: "2026-05-21T00:00:00Z",
}
expectTypeOf(userMsg).toMatchTypeOf<AgentEvent>()
expectTypeOf(assistantText).toMatchTypeOf<AgentEvent>()
expectTypeOf(toolUse).toMatchTypeOf<AgentEvent>()
expectTypeOf(toolResult).toMatchTypeOf<AgentEvent>()
expectTypeOf(turnDone).toMatchTypeOf<AgentEvent>()

// ClientMsg is a closed discriminated union by `type`.
const clientUser: ClientMsg = { type: "user", chatId: "c1", text: "hi" }
const clientNew: ClientMsg = { type: "new_chat", agent: "claude" }
const clientOpen: ClientMsg = { type: "open_chat", chatId: "c1" }
const clientCancel: ClientMsg = { type: "cancel", chatId: "c1" }
expectTypeOf(clientUser).toMatchTypeOf<ClientMsg>()
expectTypeOf(clientNew).toMatchTypeOf<ClientMsg>()
expectTypeOf(clientOpen).toMatchTypeOf<ClientMsg>()
expectTypeOf(clientCancel).toMatchTypeOf<ClientMsg>()

// ServerMsg cases
const created: ServerMsg = { type: "chat_created", chatId: "c1" }
const event: ServerMsg = { type: "event", chatId: "c1", event: turnDone }
const closed: ServerMsg = {
  type: "chat_closed",
  chatId: "c1",
  reason: "subprocess_exit",
}
const err: ServerMsg = {
  type: "agent_error",
  chatId: "c1",
  message: "x",
  recoverable: true,
}
expectTypeOf(created).toMatchTypeOf<ServerMsg>()
expectTypeOf(event).toMatchTypeOf<ServerMsg>()
expectTypeOf(closed).toMatchTypeOf<ServerMsg>()
expectTypeOf(err).toMatchTypeOf<ServerMsg>()

// AvailabilityResponse
const av: AvailabilityResponse = {
  claude: { installed: true, version: "1.2.3", authed: true },
  codex: { installed: false },
}
expectTypeOf(av).toMatchTypeOf<AvailabilityResponse>()
```

- [ ] **Step 2: Run the typecheck and verify it fails**

```
pnpm --filter @darrylondil/lorien-runtime typecheck
```

Expected: FAIL — `Cannot find module './types.js'` (no implementation yet).

- [ ] **Step 3: Create `packages/runtime/src/agent-broker/types.ts`**

```ts
/**
 * Shared types for the agent broker. The IDE imports these from
 * "@darrylondil/lorien-runtime" so the WebSocket protocol stays in lockstep
 * between server and client.
 *
 * No runtime code in this file — pure types.
 */

export type AgentName = "claude" | "codex"

/** Tool kinds we recognize. "Other" is a catch-all for tools we don't have a special card for. */
export type ToolKind = "Read" | "Edit" | "Write" | "Bash" | "Grep" | "Other"

/** Normalized agent stream event. Discriminated by `kind`. */
export type AgentEvent =
  | {
      kind: "user_message"
      text: string
      at: string
    }
  | {
      kind: "assistant_text"
      text: string
      turnId: string
      at: string
    }
  | {
      kind: "tool_use"
      toolUseId: string
      tool: ToolKind
      input: unknown
      status: "started" | "completed" | "denied" | "pending_approval"
      at: string
    }
  | {
      kind: "tool_result"
      toolUseId: string
      ok: boolean
      summary?: string
      at: string
    }
  | {
      kind: "turn_done"
      turnId: string
      usage?: { inputTokens: number; outputTokens: number }
      at: string
    }

/** Browser → broker. */
export type ClientMsg =
  | { type: "user"; chatId: string; text: string }
  | { type: "new_chat"; agent: AgentName }
  | { type: "open_chat"; chatId: string }
  | { type: "cancel"; chatId: string }

/** Broker → browser. */
export type ServerMsg =
  | { type: "chat_created"; chatId: string }
  | { type: "event"; chatId: string; event: AgentEvent }
  | {
      type: "agent_error"
      chatId: string
      message: string
      recoverable: boolean
    }
  | {
      type: "chat_closed"
      chatId: string
      reason: "subprocess_exit" | "user_cancel"
    }

/** REST GET /__lorien/agents/availability response. */
export interface AvailabilityResponse {
  claude: AgentAvailability
  codex: AgentAvailability
}

export interface AgentAvailability {
  installed: boolean
  /** CLI version string if detectable. */
  version?: string
  /** True if the CLI seems logged in. Best-effort; may be undefined when unknown. */
  authed?: boolean
}

/** REST GET /__lorien/agents/chats response. */
export interface ChatIndexEntry {
  id: string
  agent: AgentName
  title: string
  createdAt: string
  lastEventAt: string
}

export interface ChatIndex {
  version: 1
  chats: ChatIndexEntry[]
}

/** REST GET /__lorien/agents/chats/:id response. */
export interface ChatTranscript {
  id: string
  agent: AgentName
  createdAt: string
  title: string
  events: AgentEvent[]
}
```

- [ ] **Step 4: Run typecheck and verify it passes**

```
pnpm --filter @darrylondil/lorien-runtime typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```
git add packages/runtime/src/agent-broker/types.ts packages/runtime/src/agent-broker/types.test-d.ts
git commit -m "feat(runtime): agent-broker types — AgentEvent, ClientMsg, ServerMsg"
```

---

## Task 3: Claude stream-json normalizer + fixtures

Pure function `normalizeClaude(line: string): AgentEvent[]`. Tested against committed fixture lines. This is the most domain-specific piece of the broker.

**Files:**
- Create: `packages/runtime/src/agent-broker/__fixtures__/claude-stream.jsonl`
- Create: `packages/runtime/src/agent-broker/normalize-claude.ts`
- Create: `packages/runtime/src/agent-broker/normalize-claude.test.ts`

- [ ] **Step 1: Write the fixture**

Create `packages/runtime/src/agent-broker/__fixtures__/claude-stream.jsonl` with these 5 lines (one JSON per line, no trailing newline issues — use `\n` line endings):

```jsonl
{"type":"system","subtype":"init","session_id":"sess_abc123","tools":["Read","Edit","Bash"],"model":"claude-opus-4-7","cwd":"/tmp/proj"}
{"type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"I'll read the file first."}]},"session_id":"sess_abc123"}
{"type":"assistant","message":{"id":"msg_2","role":"assistant","content":[{"type":"tool_use","id":"toolu_xyz","name":"Read","input":{"path":"/tmp/proj/nodes/save-user.ts"}}]},"session_id":"sess_abc123"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_xyz","content":"export default defineNode({...})","is_error":false}]},"session_id":"sess_abc123"}
{"type":"result","subtype":"success","duration_ms":4200,"is_error":false,"session_id":"sess_abc123","total_cost_usd":0.0042,"usage":{"input_tokens":1024,"output_tokens":256}}
```

- [ ] **Step 2: Write the failing test**

Create `packages/runtime/src/agent-broker/normalize-claude.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { normalizeClaude } from "./normalize-claude.js"
import type { AgentEvent } from "./types.js"

const FIXTURE_PATH = join(
  import.meta.dirname,
  "__fixtures__",
  "claude-stream.jsonl",
)
const FIXTURE_LINES = readFileSync(FIXTURE_PATH, "utf-8").trim().split("\n")

describe("normalizeClaude", () => {
  it("returns [] for the init event (no observable event for the user)", () => {
    const out = normalizeClaude(FIXTURE_LINES[0]!)
    expect(out).toEqual([])
  })

  it("emits an assistant_text event for a text content block", () => {
    const out = normalizeClaude(FIXTURE_LINES[1]!)
    expect(out).toHaveLength(1)
    const e = out[0]!
    expect(e.kind).toBe("assistant_text")
    if (e.kind === "assistant_text") {
      expect(e.text).toBe("I'll read the file first.")
      expect(e.turnId).toBe("msg_1")
    }
  })

  it("emits a tool_use event with kind=Read for a tool_use content block", () => {
    const out = normalizeClaude(FIXTURE_LINES[2]!)
    expect(out).toHaveLength(1)
    const e = out[0]!
    expect(e.kind).toBe("tool_use")
    if (e.kind === "tool_use") {
      expect(e.toolUseId).toBe("toolu_xyz")
      expect(e.tool).toBe("Read")
      expect(e.status).toBe("started")
      expect(e.input).toEqual({ path: "/tmp/proj/nodes/save-user.ts" })
    }
  })

  it("emits a tool_result event from a user-role tool_result block", () => {
    const out = normalizeClaude(FIXTURE_LINES[3]!)
    expect(out).toHaveLength(1)
    const e = out[0]!
    expect(e.kind).toBe("tool_result")
    if (e.kind === "tool_result") {
      expect(e.toolUseId).toBe("toolu_xyz")
      expect(e.ok).toBe(true)
    }
  })

  it("emits a turn_done event for a success result with usage", () => {
    const out = normalizeClaude(FIXTURE_LINES[4]!)
    expect(out).toHaveLength(1)
    const e = out[0]!
    expect(e.kind).toBe("turn_done")
    if (e.kind === "turn_done") {
      expect(e.usage).toEqual({ inputTokens: 1024, outputTokens: 256 })
    }
  })

  it("returns [] for a non-JSON or blank line", () => {
    expect(normalizeClaude("")).toEqual([])
    expect(normalizeClaude("   ")).toEqual([])
    expect(normalizeClaude("not json at all")).toEqual([])
  })

  it("returns [] for a JSON line with an unrecognized type", () => {
    expect(
      normalizeClaude(JSON.stringify({ type: "mystery", payload: 42 })),
    ).toEqual([])
  })

  it("stamps every emitted event with an ISO `at` timestamp", () => {
    const out = normalizeClaude(FIXTURE_LINES[1]!)
    expect(out[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("multiple content blocks in one assistant message yield multiple events in order", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_multi",
        role: "assistant",
        content: [
          { type: "text", text: "Reading then editing." },
          {
            type: "tool_use",
            id: "toolu_a",
            name: "Edit",
            input: { path: "x" },
          },
        ],
      },
      session_id: "s",
    })
    const out = normalizeClaude(line)
    expect(out.map((e: AgentEvent) => e.kind)).toEqual([
      "assistant_text",
      "tool_use",
    ])
    expect((out[1] as Extract<AgentEvent, { kind: "tool_use" }>).tool).toBe(
      "Edit",
    )
  })

  it("collapses unknown tool names to 'Other'", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_unk",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_u",
            name: "ExperimentalThing",
            input: {},
          },
        ],
      },
      session_id: "s",
    })
    const out = normalizeClaude(line)
    expect((out[0] as Extract<AgentEvent, { kind: "tool_use" }>).tool).toBe(
      "Other",
    )
  })
})
```

- [ ] **Step 3: Run the test, confirm it fails**

```
pnpm --filter @darrylondil/lorien-runtime test normalize-claude
```

Expected: FAIL — `Cannot find module './normalize-claude.js'`.

- [ ] **Step 4: Write the normalizer**

Create `packages/runtime/src/agent-broker/normalize-claude.ts`:

```ts
import type { AgentEvent, ToolKind } from "./types.js"

const KNOWN_TOOLS = new Set<ToolKind>([
  "Read",
  "Edit",
  "Write",
  "Bash",
  "Grep",
])

function classifyTool(name: string): ToolKind {
  return KNOWN_TOOLS.has(name as ToolKind) ? (name as ToolKind) : "Other"
}

function now(): string {
  return new Date().toISOString()
}

/**
 * Convert one line of Claude Code's `--output-format stream-json` output into
 * zero or more normalized `AgentEvent`s. Defensive: returns `[]` for any line
 * that doesn't parse or whose shape we don't recognize.
 */
export function normalizeClaude(line: string): AgentEvent[] {
  const trimmed = line.trim()
  if (trimmed.length === 0) return []
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return []
  }
  if (!raw || typeof raw !== "object") return []

  const obj = raw as Record<string, unknown>
  const type = obj.type

  if (type === "system") {
    // init/system events carry session_id and tool list; useful for the
    // subprocess driver (which inspects the raw stream) but not for the
    // chat UI. Emit nothing.
    return []
  }

  if (type === "assistant") {
    const message = obj.message as
      | { id?: string; content?: unknown[] }
      | undefined
    if (!message || !Array.isArray(message.content)) return []
    const turnId = typeof message.id === "string" ? message.id : ""
    const events: AgentEvent[] = []
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue
      const b = block as Record<string, unknown>
      if (b.type === "text" && typeof b.text === "string") {
        events.push({
          kind: "assistant_text",
          text: b.text,
          turnId,
          at: now(),
        })
      } else if (
        b.type === "tool_use" &&
        typeof b.id === "string" &&
        typeof b.name === "string"
      ) {
        events.push({
          kind: "tool_use",
          toolUseId: b.id,
          tool: classifyTool(b.name),
          input: b.input,
          status: "started",
          at: now(),
        })
      }
    }
    return events
  }

  if (type === "user") {
    const message = obj.message as { content?: unknown[] } | undefined
    if (!message || !Array.isArray(message.content)) return []
    const events: AgentEvent[] = []
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue
      const b = block as Record<string, unknown>
      if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        const isError = b.is_error === true
        const summary =
          typeof b.content === "string" ? b.content.slice(0, 200) : undefined
        events.push({
          kind: "tool_result",
          toolUseId: b.tool_use_id,
          ok: !isError,
          ...(summary !== undefined ? { summary } : {}),
          at: now(),
        })
      }
    }
    return events
  }

  if (type === "result") {
    const turnId =
      typeof obj.session_id === "string" ? `result-${obj.session_id}` : "result"
    const usage = obj.usage as
      | { input_tokens?: number; output_tokens?: number }
      | undefined
    const ev: Extract<AgentEvent, { kind: "turn_done" }> = {
      kind: "turn_done",
      turnId,
      at: now(),
    }
    if (
      usage &&
      typeof usage.input_tokens === "number" &&
      typeof usage.output_tokens === "number"
    ) {
      ev.usage = {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      }
    }
    return [ev]
  }

  return []
}

/**
 * Extract the Claude session id from a raw line if it's the init/system event.
 * The subprocess driver uses this to capture the id for future `--resume`.
 */
export function extractClaudeSessionId(line: string): string | null {
  try {
    const obj = JSON.parse(line.trim()) as Record<string, unknown>
    if (obj.type === "system" && typeof obj.session_id === "string") {
      return obj.session_id
    }
  } catch {
    /* fallthrough */
  }
  return null
}
```

- [ ] **Step 5: Run the test, confirm it passes**

```
pnpm --filter @darrylondil/lorien-runtime test normalize-claude
```

Expected: all assertions pass.

- [ ] **Step 6: Commit**

```
git add packages/runtime/src/agent-broker/normalize-claude.ts packages/runtime/src/agent-broker/normalize-claude.test.ts "packages/runtime/src/agent-broker/__fixtures__/claude-stream.jsonl"
git commit -m "feat(runtime): Claude stream-json normalizer with fixtures"
```

---

## Task 4: Transcript writer

Per-chat JSON append with atomic write semantics, index maintenance, and corrupted-file quarantine.

**Files:**
- Create: `packages/runtime/src/agent-broker/transcript.ts`
- Create: `packages/runtime/src/agent-broker/transcript.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/src/agent-broker/transcript.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  appendChatEvent,
  createChat,
  listChats,
  loadChat,
  TranscriptStore,
} from "./transcript.js"
import type { AgentEvent } from "./types.js"

describe("transcript store", () => {
  let root: string
  let store: TranscriptStore

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lorien-transcript-"))
    store = new TranscriptStore(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("createChat writes both the chat file and the index entry", async () => {
    const id = await store.createChat({ agent: "claude", title: "First chat" })
    expect(id).toMatch(/^[a-z0-9-]+$/i)
    const chat = await store.loadChat(id)
    expect(chat?.agent).toBe("claude")
    expect(chat?.title).toBe("First chat")
    expect(chat?.events).toEqual([])
    const idx = await store.listChats()
    expect(idx.chats).toHaveLength(1)
    expect(idx.chats[0]!.id).toBe(id)
  })

  it("appendChatEvent appends and updates lastEventAt in the index", async () => {
    const id = await store.createChat({ agent: "claude", title: "t" })
    const ev: AgentEvent = {
      kind: "user_message",
      text: "hi",
      at: "2026-05-21T00:00:00.000Z",
    }
    await store.appendChatEvent(id, ev)
    const chat = await store.loadChat(id)
    expect(chat?.events).toHaveLength(1)
    expect(chat?.events[0]).toEqual(ev)
    const idx = await store.listChats()
    expect(idx.chats[0]!.lastEventAt).toBe("2026-05-21T00:00:00.000Z")
  })

  it("loadChat returns null when the id is unknown", async () => {
    expect(await store.loadChat("nope")).toBeNull()
  })

  it("listChats sorts by lastEventAt descending", async () => {
    const a = await store.createChat({ agent: "claude", title: "A" })
    const b = await store.createChat({ agent: "claude", title: "B" })
    await store.appendChatEvent(a, {
      kind: "user_message",
      text: "old",
      at: "2026-01-01T00:00:00.000Z",
    })
    await store.appendChatEvent(b, {
      kind: "user_message",
      text: "new",
      at: "2026-05-21T00:00:00.000Z",
    })
    const idx = await store.listChats()
    expect(idx.chats.map((c) => c.id)).toEqual([b, a])
  })

  it("quarantines a corrupted chat file on load and surfaces null", async () => {
    const id = await store.createChat({ agent: "claude", title: "tbd" })
    writeFileSync(
      join(root, ".lorien", "chats", `${id}.json`),
      "{ not valid json",
      "utf-8",
    )
    const result = await store.loadChat(id)
    expect(result).toBeNull()
    // The corrupted file moves to .broken/
    const broken = readFileSync(
      join(root, ".lorien", "chats", ".broken").toString(),
    )
    expect(broken).toBeTruthy() // dir exists
  })

  it("atomic write — concurrent appends don't lose events", async () => {
    const id = await store.createChat({ agent: "claude", title: "race" })
    const events: AgentEvent[] = Array.from({ length: 25 }, (_, i) => ({
      kind: "user_message",
      text: `msg-${i}`,
      at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    }))
    await Promise.all(events.map((e) => store.appendChatEvent(id, e)))
    const chat = await store.loadChat(id)
    expect(chat?.events).toHaveLength(25)
    // All events present, regardless of order
    const texts = (chat?.events ?? []).map((e) =>
      e.kind === "user_message" ? e.text : "",
    )
    for (let i = 0; i < 25; i++) {
      expect(texts).toContain(`msg-${i}`)
    }
  })

  it("createChat + appendChatEvent are usable via the loose-function API too", async () => {
    const id = await createChat(root, {
      agent: "claude",
      title: "loose",
    })
    await appendChatEvent(root, id, {
      kind: "user_message",
      text: "hi",
      at: "2026-05-21T00:00:00.000Z",
    })
    const chat = await loadChat(root, id)
    expect(chat?.events).toHaveLength(1)
    const idx = await listChats(root)
    expect(idx.chats).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run, expect failure**

```
pnpm --filter @darrylondil/lorien-runtime test transcript
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the transcript module**

Create `packages/runtime/src/agent-broker/transcript.ts`:

```ts
import { randomUUID } from "node:crypto"
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises"
import { dirname, join } from "node:path"
import type {
  AgentEvent,
  AgentName,
  ChatIndex,
  ChatIndexEntry,
  ChatTranscript,
} from "./types.js"

const INDEX_VERSION = 1 as const

interface ChatsLayout {
  chatsDir: string
  brokenDir: string
  indexPath: string
  chatPath: (id: string) => string
}

function layout(projectRoot: string): ChatsLayout {
  const chatsDir = join(projectRoot, ".lorien", "chats")
  return {
    chatsDir,
    brokenDir: join(chatsDir, ".broken"),
    indexPath: join(chatsDir, "index.json"),
    chatPath: (id: string) => join(chatsDir, `${id}.json`),
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const text = await readFile(p, "utf-8")
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

async function writeJsonAtomic(p: string, value: unknown): Promise<void> {
  await mkdir(dirname(p), { recursive: true })
  const tmp = `${p}.tmp-${randomUUID()}`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
  await rename(tmp, p)
}

async function loadIndex(l: ChatsLayout): Promise<ChatIndex> {
  const idx = await readJson<ChatIndex>(l.indexPath)
  if (!idx || idx.version !== INDEX_VERSION) {
    return { version: INDEX_VERSION, chats: [] }
  }
  return idx
}

async function saveIndex(l: ChatsLayout, idx: ChatIndex): Promise<void> {
  idx.chats.sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))
  await writeJsonAtomic(l.indexPath, idx)
}

/**
 * Process-local serialization queue per chat id. Concurrent calls to
 * appendChatEvent for the same chat are queued so the read-modify-write cycle
 * stays consistent. Cross-process safety is not provided — `lorien dev` is
 * single-process.
 */
const chatQueues = new Map<string, Promise<unknown>>()

function withChatLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prior = chatQueues.get(key) ?? Promise.resolve()
  const next = prior.then(fn, fn)
  chatQueues.set(
    key,
    next.catch(() => undefined),
  )
  return next
}

export interface CreateChatInput {
  agent: AgentName
  title: string
}

export async function createChat(
  projectRoot: string,
  input: CreateChatInput,
): Promise<string> {
  const l = layout(projectRoot)
  await mkdir(l.chatsDir, { recursive: true })
  const id = randomUUID()
  const now = new Date().toISOString()
  const transcript: ChatTranscript = {
    id,
    agent: input.agent,
    createdAt: now,
    title: input.title,
    events: [],
  }
  await writeJsonAtomic(l.chatPath(id), transcript)
  await withChatLock(`${projectRoot}::index`, async () => {
    const idx = await loadIndex(l)
    const entry: ChatIndexEntry = {
      id,
      agent: input.agent,
      title: input.title,
      createdAt: now,
      lastEventAt: now,
    }
    idx.chats.push(entry)
    await saveIndex(l, idx)
  })
  return id
}

export async function appendChatEvent(
  projectRoot: string,
  id: string,
  event: AgentEvent,
): Promise<void> {
  const l = layout(projectRoot)
  await withChatLock(`${projectRoot}::${id}`, async () => {
    const chat = await readJson<ChatTranscript>(l.chatPath(id))
    if (!chat) throw new Error(`Chat ${id} not found`)
    chat.events.push(event)
    await writeJsonAtomic(l.chatPath(id), chat)
  })
  await withChatLock(`${projectRoot}::index`, async () => {
    const idx = await loadIndex(l)
    const e = idx.chats.find((c) => c.id === id)
    if (e) {
      e.lastEventAt = event.at
      await saveIndex(l, idx)
    }
  })
}

export async function loadChat(
  projectRoot: string,
  id: string,
): Promise<ChatTranscript | null> {
  const l = layout(projectRoot)
  const path = l.chatPath(id)
  if (!(await exists(path))) return null
  const text = await readFile(path, "utf-8").catch(() => null)
  if (text === null) return null
  try {
    return JSON.parse(text) as ChatTranscript
  } catch {
    await mkdir(l.brokenDir, { recursive: true })
    const stamp = Date.now()
    await rename(path, join(l.brokenDir, `${id}.${stamp}.json`))
    return null
  }
}

export async function listChats(projectRoot: string): Promise<ChatIndex> {
  const l = layout(projectRoot)
  if (!(await exists(l.indexPath))) {
    return { version: INDEX_VERSION, chats: [] }
  }
  const idx = await loadIndex(l)
  // Defensive: drop entries whose files were deleted.
  const entries = await readdir(l.chatsDir).catch(() => [] as string[])
  const present = new Set(
    entries
      .filter((f) => f.endsWith(".json") && f !== "index.json")
      .map((f) => f.slice(0, -".json".length)),
  )
  idx.chats = idx.chats.filter((c) => present.has(c.id))
  return idx
}

/** Convenience class for callers that hold a fixed project root. */
export class TranscriptStore {
  constructor(private readonly projectRoot: string) {}
  createChat(input: CreateChatInput): Promise<string> {
    return createChat(this.projectRoot, input)
  }
  appendChatEvent(id: string, event: AgentEvent): Promise<void> {
    return appendChatEvent(this.projectRoot, id, event)
  }
  loadChat(id: string): Promise<ChatTranscript | null> {
    return loadChat(this.projectRoot, id)
  }
  listChats(): Promise<ChatIndex> {
    return listChats(this.projectRoot)
  }
}
```

- [ ] **Step 4: Run tests, confirm pass**

```
pnpm --filter @darrylondil/lorien-runtime test transcript
```

Expected: all assertions pass, including the concurrency test.

- [ ] **Step 5: Commit**

```
git add packages/runtime/src/agent-broker/transcript.ts packages/runtime/src/agent-broker/transcript.test.ts
git commit -m "feat(runtime): transcript store with atomic append + corrupted-file quarantine"
```

---

## Task 5: CLI availability probe

Detect whether `claude` and `codex` are on PATH and what version is installed. 30s in-memory cache.

**Files:**
- Create: `packages/runtime/src/agent-broker/availability.ts`
- Create: `packages/runtime/src/agent-broker/availability.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/src/agent-broker/availability.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import {
  AvailabilityProbe,
  type ProbeExec,
} from "./availability.js"

describe("AvailabilityProbe", () => {
  it("reports installed=true and a version when the CLI exits 0", async () => {
    const exec: ProbeExec = vi.fn(async (cmd) => {
      if (cmd === "claude")
        return { exitCode: 0, stdout: "claude-code 1.2.3\n", stderr: "" }
      return { exitCode: 127, stdout: "", stderr: "not found" }
    })
    const probe = new AvailabilityProbe({ exec, now: () => 0 })
    const av = await probe.probe()
    expect(av.claude.installed).toBe(true)
    expect(av.claude.version).toBe("1.2.3")
    expect(av.codex.installed).toBe(false)
  })

  it("strips ANSI / leading-whitespace from version output", async () => {
    const exec: ProbeExec = vi.fn(async () => ({
      exitCode: 0,
      stdout: "  Claude Code v 4.5.6 (build abc)\n",
      stderr: "",
    }))
    const probe = new AvailabilityProbe({ exec, now: () => 0 })
    const av = await probe.probe()
    expect(av.claude.version).toBe("4.5.6")
  })

  it("returns installed=false when the CLI exits non-zero", async () => {
    const exec: ProbeExec = vi.fn(async () => ({
      exitCode: 127,
      stdout: "",
      stderr: "command not found",
    }))
    const probe = new AvailabilityProbe({ exec, now: () => 0 })
    const av = await probe.probe()
    expect(av.claude.installed).toBe(false)
    expect(av.codex.installed).toBe(false)
  })

  it("caches the result for 30s and re-probes after", async () => {
    let calls = 0
    const exec: ProbeExec = vi.fn(async () => {
      calls++
      return { exitCode: 0, stdout: "claude 9.9.9", stderr: "" }
    })
    let nowValue = 0
    const probe = new AvailabilityProbe({ exec, now: () => nowValue })
    await probe.probe()
    await probe.probe()
    await probe.probe()
    expect(calls).toBe(2) // two binaries probed once each
    nowValue = 25_000
    await probe.probe()
    expect(calls).toBe(2) // still cached
    nowValue = 31_000
    await probe.probe()
    expect(calls).toBe(4) // both re-probed
  })

  it("treats exec rejection (ENOENT etc.) as not installed", async () => {
    const exec: ProbeExec = vi.fn(async () => {
      throw new Error("ENOENT")
    })
    const probe = new AvailabilityProbe({ exec, now: () => 0 })
    const av = await probe.probe()
    expect(av.claude.installed).toBe(false)
  })
})
```

- [ ] **Step 2: Run, expect failure**

```
pnpm --filter @darrylondil/lorien-runtime test availability
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/runtime/src/agent-broker/availability.ts`:

```ts
import { spawn } from "node:child_process"
import type {
  AgentAvailability,
  AgentName,
  AvailabilityResponse,
} from "./types.js"

export interface ProbeExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type ProbeExec = (
  command: string,
  args: string[],
) => Promise<ProbeExecResult>

interface CacheEntry {
  expiresAt: number
  result: AvailabilityResponse
}

const CACHE_TTL_MS = 30_000

/**
 * Default exec: spawns the binary with `--version` and waits for exit with a
 * short hard timeout. Promise resolves with the result on any exit (success
 * or failure) and rejects only on spawn errors (e.g. ENOENT).
 */
const defaultExec: ProbeExec = (command, args) =>
  new Promise<ProbeExecResult>((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    const timer = setTimeout(() => {
      proc.kill("SIGKILL")
    }, 3000)
    proc.stdout.on("data", (d) => {
      stdout += String(d)
    })
    proc.stderr.on("data", (d) => {
      stderr += String(d)
    })
    proc.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc.on("close", (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })
  })

const VERSION_RE = /(\d+\.\d+\.\d+)/

function parseVersion(stdout: string): string | undefined {
  const m = VERSION_RE.exec(stdout)
  return m ? m[1] : undefined
}

const BINARIES: Record<AgentName, string> = {
  claude: "claude",
  codex: "codex",
}

export interface AvailabilityProbeOptions {
  exec?: ProbeExec
  now?: () => number
}

export class AvailabilityProbe {
  private readonly exec: ProbeExec
  private readonly now: () => number
  private cache: CacheEntry | null = null

  constructor(opts: AvailabilityProbeOptions = {}) {
    this.exec = opts.exec ?? defaultExec
    this.now = opts.now ?? Date.now
  }

  async probe(): Promise<AvailabilityResponse> {
    const t = this.now()
    if (this.cache && this.cache.expiresAt > t) {
      return this.cache.result
    }
    const [claude, codex] = await Promise.all([
      this.probeOne(BINARIES.claude),
      this.probeOne(BINARIES.codex),
    ])
    const result: AvailabilityResponse = { claude, codex }
    this.cache = { result, expiresAt: t + CACHE_TTL_MS }
    return result
  }

  private async probeOne(binary: string): Promise<AgentAvailability> {
    try {
      const r = await this.exec(binary, ["--version"])
      if (r.exitCode !== 0) return { installed: false }
      const version = parseVersion(r.stdout || r.stderr)
      return version === undefined
        ? { installed: true }
        : { installed: true, version }
    } catch {
      return { installed: false }
    }
  }
}
```

- [ ] **Step 4: Run tests, confirm pass**

```
pnpm --filter @darrylondil/lorien-runtime test availability
```

Expected: all assertions pass.

- [ ] **Step 5: Commit**

```
git add packages/runtime/src/agent-broker/availability.ts packages/runtime/src/agent-broker/availability.test.ts
git commit -m "feat(runtime): CLI availability probe with 30s cache"
```

---

## Task 6: Mock CLI fixture script + subprocess driver

`spawnClaude` wraps `child_process.spawn` and emits normalized events. The `mock-cli.ts` fixture mimics the real CLI in a controllable way for tests.

**Files:**
- Create: `packages/runtime/src/agent-broker/__fixtures__/mock-cli.ts`
- Create: `packages/runtime/src/agent-broker/subprocess.ts`
- Create: `packages/runtime/src/agent-broker/subprocess.test.ts`

- [ ] **Step 1: Write the mock CLI fixture**

Create `packages/runtime/src/agent-broker/__fixtures__/mock-cli.ts`:

```ts
#!/usr/bin/env node
/**
 * Mock Claude Code CLI for subprocess driver tests.
 *
 * Behavior:
 * - On startup, emits a system/init event with a fixed session id.
 * - For each line received on stdin (the user's stream-json message), emits:
 *     assistant text → tool_use(Read) → user tool_result → result
 *   simulating one full agent turn.
 * - Exits cleanly when stdin closes.
 * - Honors `LORIEN_MOCK_DELAY_MS` env var (default 0) to simulate timing.
 */
import { createInterface } from "node:readline"

const SESSION_ID = process.env.LORIEN_MOCK_SESSION_ID ?? "sess_mock_001"
const DELAY = Number(process.env.LORIEN_MOCK_DELAY_MS ?? "0")

function emit(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function run(): Promise<void> {
  emit({
    type: "system",
    subtype: "init",
    session_id: SESSION_ID,
    tools: ["Read", "Edit", "Bash"],
    model: "mock-model",
    cwd: process.cwd(),
  })

  const rl = createInterface({ input: process.stdin })
  let turn = 0
  for await (const line of rl) {
    if (line.trim() === "") continue
    turn += 1
    const msgId = `msg_${turn}`
    const toolId = `toolu_${turn}`

    if (DELAY) await sleep(DELAY)
    emit({
      type: "assistant",
      message: {
        id: msgId,
        role: "assistant",
        content: [{ type: "text", text: `mock reply ${turn}` }],
      },
      session_id: SESSION_ID,
    })

    if (DELAY) await sleep(DELAY)
    emit({
      type: "assistant",
      message: {
        id: msgId,
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: toolId,
            name: "Read",
            input: { path: `/mock/file-${turn}.ts` },
          },
        ],
      },
      session_id: SESSION_ID,
    })

    if (DELAY) await sleep(DELAY)
    emit({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolId,
            content: "mock file body",
            is_error: false,
          },
        ],
      },
      session_id: SESSION_ID,
    })

    if (DELAY) await sleep(DELAY)
    emit({
      type: "result",
      subtype: "success",
      duration_ms: 10,
      is_error: false,
      session_id: SESSION_ID,
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
    })
  }
}

run().catch((err) => {
  process.stderr.write(`mock-cli error: ${String(err)}\n`)
  process.exit(1)
})
```

Mark it executable on Unix (Windows doesn't care): not strictly required — we will spawn via `node <path>`.

- [ ] **Step 2: Write the failing subprocess test**

Create `packages/runtime/src/agent-broker/subprocess.test.ts`:

```ts
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { spawnClaude } from "./subprocess.js"
import type { AgentEvent } from "./types.js"

const MOCK_CLI = join(import.meta.dirname, "__fixtures__", "mock-cli.ts")

async function collect(
  iter: AsyncIterable<AgentEvent>,
  count: number,
  timeoutMs = 5000,
): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  const start = Date.now()
  for await (const e of iter) {
    out.push(e)
    if (out.length >= count) break
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timeout collecting events; got ${out.length}/${count}`,
      )
    }
  }
  return out
}

describe("spawnClaude (via mock CLI)", () => {
  it("emits assistant_text → tool_use → tool_result → turn_done per user turn", async () => {
    const proc = spawnClaude({
      chatId: "c1",
      projectRoot: process.cwd(),
      command: process.execPath, // node
      // We override the args to point at the mock-cli .ts via tsx loader.
      argsOverride: ["--import", "tsx", MOCK_CLI],
    })
    proc.send("hello")
    const events = await collect(proc.events, 4)
    expect(events.map((e) => e.kind)).toEqual([
      "assistant_text",
      "tool_use",
      "tool_result",
      "turn_done",
    ])
    proc.kill()
  })

  it("captures the session id from the init event", async () => {
    const proc = spawnClaude({
      chatId: "c2",
      projectRoot: process.cwd(),
      command: process.execPath,
      argsOverride: ["--import", "tsx", MOCK_CLI],
    })
    // Give the mock a beat to emit the init event before we ask.
    await new Promise((r) => setTimeout(r, 100))
    expect(proc.sessionId()).toBe("sess_mock_001")
    proc.kill()
  })

  it("kill() exits cleanly", async () => {
    const proc = spawnClaude({
      chatId: "c3",
      projectRoot: process.cwd(),
      command: process.execPath,
      argsOverride: ["--import", "tsx", MOCK_CLI],
    })
    const exitPromise = proc.exit
    proc.kill()
    const code = await exitPromise
    expect(code === 0 || code === null || code === 143).toBe(true)
  })
})
```

- [ ] **Step 3: Run, expect failure**

```
pnpm --filter @darrylondil/lorien-runtime test subprocess
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `subprocess.ts`**

Create `packages/runtime/src/agent-broker/subprocess.ts`:

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import {
  extractClaudeSessionId,
  normalizeClaude,
} from "./normalize-claude.js"
import type { AgentEvent } from "./types.js"

export interface SpawnClaudeOptions {
  chatId: string
  projectRoot: string
  /** Resume an existing CLI session. */
  resumeSessionId?: string
  /** Override the binary (defaults to "claude"). Used by tests. */
  command?: string
  /** Override the args list entirely (used by tests with the mock CLI). */
  argsOverride?: string[]
  /** Env overrides. */
  env?: NodeJS.ProcessEnv
}

export interface ClaudeProcess {
  /** Normalized stream of events. Closes when the subprocess exits. */
  events: AsyncIterable<AgentEvent>
  /** Send a user message line (will be wrapped into stream-json shape). */
  send(text: string): void
  /** Kill the subprocess (SIGTERM). */
  kill(): void
  /** Resolves with the exit code when the subprocess ends. */
  readonly exit: Promise<number | null>
  /** Latest session id seen from the CLI (captured from the init event). */
  sessionId(): string | null
}

function defaultArgs(resumeSessionId?: string): string[] {
  const a = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--permission-mode",
    "bypassPermissions",
  ]
  if (resumeSessionId) {
    a.push("--resume", resumeSessionId)
  }
  return a
}

export function spawnClaude(opts: SpawnClaudeOptions): ClaudeProcess {
  const command = opts.command ?? "claude"
  const args = opts.argsOverride ?? defaultArgs(opts.resumeSessionId)
  const child: ChildProcessWithoutNullStreams = spawn(command, args, {
    cwd: opts.projectRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...opts.env },
  })

  // Async iterable over normalized events. We push values into a queue; the
  // consumer reads via an async iterator.
  type Resolver = (v: IteratorResult<AgentEvent>) => void
  const queue: AgentEvent[] = []
  const waiters: Resolver[] = []
  let done = false

  function push(ev: AgentEvent): void {
    const w = waiters.shift()
    if (w) {
      w({ value: ev, done: false })
    } else {
      queue.push(ev)
    }
  }
  function finish(): void {
    if (done) return
    done = true
    for (const w of waiters.splice(0)) {
      w({ value: undefined as unknown as AgentEvent, done: true })
    }
  }

  let sessionId: string | null = null

  const rl = createInterface({ input: child.stdout })
  rl.on("line", (line) => {
    const sid = extractClaudeSessionId(line)
    if (sid) sessionId = sid
    for (const ev of normalizeClaude(line)) push(ev)
  })
  rl.on("close", finish)
  child.on("error", finish)

  const exit: Promise<number | null> = new Promise((resolve) => {
    child.on("close", (code) => {
      finish()
      resolve(code)
    })
  })

  const events: AsyncIterable<AgentEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next: (): Promise<IteratorResult<AgentEvent>> => {
          if (queue.length > 0) {
            const value = queue.shift()!
            return Promise.resolve({ value, done: false })
          }
          if (done) {
            return Promise.resolve({
              value: undefined as unknown as AgentEvent,
              done: true,
            })
          }
          return new Promise<IteratorResult<AgentEvent>>((resolve) => {
            waiters.push(resolve)
          })
        },
      }
    },
  }

  return {
    events,
    send(text: string) {
      const msg = JSON.stringify({
        type: "user",
        message: { role: "user", content: text },
      })
      child.stdin.write(`${msg}\n`)
    },
    kill() {
      try {
        child.kill("SIGTERM")
      } catch {
        /* ignore */
      }
    },
    exit,
    sessionId: () => sessionId,
  }
}
```

- [ ] **Step 5: Confirm `tsx` is available**

Task 1 already added `tsx` to runtime's devDeps. Sanity-check:

```
pnpm --filter @darrylondil/lorien-runtime ls tsx
```

Expected: shows a resolved version. If not, repeat Task 1's install step.

- [ ] **Step 6: Run subprocess tests, confirm pass**

```
pnpm --filter @darrylondil/lorien-runtime test subprocess
```

Expected: 3 tests pass. The test imports the mock-cli via `node --import tsx`; that's why tsx must be available.

- [ ] **Step 7: Commit**

```
git add packages/runtime/src/agent-broker/subprocess.ts packages/runtime/src/agent-broker/subprocess.test.ts "packages/runtime/src/agent-broker/__fixtures__/mock-cli.ts"
git commit -m "feat(runtime): Claude subprocess driver with mock-cli fixture"
```

---

## Task 7: Subscriber registry

Map chatId → Set<WebSocket>. Centralizes fan-out and "any subscribers left?" checks for subprocess lifecycle.

**Files:**
- Create: `packages/runtime/src/agent-broker/subscribers.ts`
- Create: `packages/runtime/src/agent-broker/subscribers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/src/agent-broker/subscribers.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { SubscriberRegistry, type SocketLike } from "./subscribers.js"

function makeSocket(): SocketLike & { messages: string[] } {
  const messages: string[] = []
  return {
    messages,
    send(data: string) {
      messages.push(data)
    },
    isOpen() {
      return true
    },
  }
}

describe("SubscriberRegistry", () => {
  it("subscribe + broadcast sends to all subscribers of a chat", () => {
    const reg = new SubscriberRegistry()
    const a = makeSocket()
    const b = makeSocket()
    reg.subscribe("c1", a)
    reg.subscribe("c1", b)
    reg.broadcast("c1", { type: "event", chatId: "c1", event: { kind: "turn_done", turnId: "t", at: "x" } })
    expect(a.messages).toHaveLength(1)
    expect(b.messages).toHaveLength(1)
  })

  it("broadcast does NOT send to subscribers of other chats", () => {
    const reg = new SubscriberRegistry()
    const a = makeSocket()
    const b = makeSocket()
    reg.subscribe("c1", a)
    reg.subscribe("c2", b)
    reg.broadcast("c1", { type: "chat_created", chatId: "c1" })
    expect(a.messages).toHaveLength(1)
    expect(b.messages).toHaveLength(0)
  })

  it("unsubscribe stops delivery", () => {
    const reg = new SubscriberRegistry()
    const a = makeSocket()
    reg.subscribe("c1", a)
    reg.unsubscribe("c1", a)
    reg.broadcast("c1", { type: "chat_created", chatId: "c1" })
    expect(a.messages).toHaveLength(0)
  })

  it("unsubscribe also removes from all other chats (when used at disconnect)", () => {
    const reg = new SubscriberRegistry()
    const a = makeSocket()
    reg.subscribe("c1", a)
    reg.subscribe("c2", a)
    reg.unsubscribeAll(a)
    expect(reg.isAnyOnline("c1")).toBe(false)
    expect(reg.isAnyOnline("c2")).toBe(false)
  })

  it("isAnyOnline returns false when no subscribers and true otherwise", () => {
    const reg = new SubscriberRegistry()
    expect(reg.isAnyOnline("c1")).toBe(false)
    const a = makeSocket()
    reg.subscribe("c1", a)
    expect(reg.isAnyOnline("c1")).toBe(true)
  })

  it("skips sockets where isOpen() returns false", () => {
    const reg = new SubscriberRegistry()
    const closed: SocketLike & { messages: string[] } = {
      messages: [],
      send: vi.fn((d: string) => {
        closed.messages.push(d)
      }),
      isOpen: () => false,
    }
    reg.subscribe("c1", closed)
    reg.broadcast("c1", { type: "chat_created", chatId: "c1" })
    expect(closed.messages).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run, expect failure**

```
pnpm --filter @darrylondil/lorien-runtime test subscribers
```

Expected: module missing.

- [ ] **Step 3: Implement**

Create `packages/runtime/src/agent-broker/subscribers.ts`:

```ts
import type { ServerMsg } from "./types.js"

/** Minimal interface over `ws` WebSocket — kept narrow for testability. */
export interface SocketLike {
  send(data: string): void
  isOpen(): boolean
}

export class SubscriberRegistry {
  private readonly perChat = new Map<string, Set<SocketLike>>()

  subscribe(chatId: string, sock: SocketLike): void {
    let set = this.perChat.get(chatId)
    if (!set) {
      set = new Set()
      this.perChat.set(chatId, set)
    }
    set.add(sock)
  }

  unsubscribe(chatId: string, sock: SocketLike): void {
    const set = this.perChat.get(chatId)
    if (!set) return
    set.delete(sock)
    if (set.size === 0) this.perChat.delete(chatId)
  }

  /** Remove a socket from every chat it was subscribed to (e.g. on disconnect). */
  unsubscribeAll(sock: SocketLike): void {
    for (const [id, set] of this.perChat) {
      set.delete(sock)
      if (set.size === 0) this.perChat.delete(id)
    }
  }

  isAnyOnline(chatId: string): boolean {
    const set = this.perChat.get(chatId)
    if (!set) return false
    for (const s of set) if (s.isOpen()) return true
    return false
  }

  broadcast(chatId: string, msg: ServerMsg): void {
    const set = this.perChat.get(chatId)
    if (!set) return
    const payload = JSON.stringify(msg)
    for (const s of set) {
      if (s.isOpen()) s.send(payload)
    }
  }
}
```

- [ ] **Step 4: Run, confirm pass**

```
pnpm --filter @darrylondil/lorien-runtime test subscribers
```

Expected: all assertions pass.

- [ ] **Step 5: Commit**

```
git add packages/runtime/src/agent-broker/subscribers.ts packages/runtime/src/agent-broker/subscribers.test.ts
git commit -m "feat(runtime): per-chat WebSocket subscriber registry"
```

---

## Task 8: `mountAgentBroker` — REST endpoints

REST surface mounted on a Hono app. Reads from availability + transcript modules. No WebSocket yet.

**Files:**
- Create: `packages/runtime/src/agent-broker/server.ts` (REST portion only — WS lands in Task 9)
- Create: `packages/runtime/src/agent-broker/server.test.ts` (REST portion)

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/src/agent-broker/server.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AvailabilityProbe } from "./availability.js"
import { mountAgentBroker } from "./server.js"
import { TranscriptStore } from "./transcript.js"

describe("mountAgentBroker — REST", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lorien-broker-rest-"))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("GET /__lorien/agents/availability returns the probed shape", async () => {
    const app = new Hono()
    const availability = new AvailabilityProbe({
      exec: async () => ({ exitCode: 0, stdout: "v 9.9.9", stderr: "" }),
      now: () => 0,
    })
    mountAgentBroker(app, { projectRoot: root, availability })
    const res = await app.request("/__lorien/agents/availability")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.claude.installed).toBe(true)
    expect(body.codex.installed).toBe(true) // mock exec answers for both
  })

  it("GET /__lorien/agents/chats returns an empty index initially", async () => {
    const app = new Hono()
    mountAgentBroker(app, { projectRoot: root })
    const res = await app.request("/__lorien/agents/chats")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.version).toBe(1)
    expect(body.chats).toEqual([])
  })

  it("GET /__lorien/agents/chats/:id returns 404 when missing", async () => {
    const app = new Hono()
    mountAgentBroker(app, { projectRoot: root })
    const res = await app.request("/__lorien/agents/chats/nope")
    expect(res.status).toBe(404)
  })

  it("GET /__lorien/agents/chats/:id returns the transcript when present", async () => {
    const app = new Hono()
    mountAgentBroker(app, { projectRoot: root })
    const store = new TranscriptStore(root)
    const id = await store.createChat({ agent: "claude", title: "hi" })
    const res = await app.request(`/__lorien/agents/chats/${id}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(id)
    expect(body.events).toEqual([])
  })
})
```

- [ ] **Step 2: Run, expect failure**

```
pnpm --filter @darrylondil/lorien-runtime test server
```

Expected: module missing.

- [ ] **Step 3: Implement REST `mountAgentBroker`**

Create `packages/runtime/src/agent-broker/server.ts`:

```ts
import type { Hono } from "hono"
import { AvailabilityProbe } from "./availability.js"
import { listChats, loadChat } from "./transcript.js"

export interface MountAgentBrokerOptions {
  projectRoot: string
  /** Inject a custom probe in tests; defaults to the real one. */
  availability?: AvailabilityProbe
}

export function mountAgentBroker(
  app: Hono,
  opts: MountAgentBrokerOptions,
): void {
  const availability = opts.availability ?? new AvailabilityProbe()

  app.get("/__lorien/agents/availability", async (c) => {
    const r = await availability.probe()
    return c.json(r)
  })

  app.get("/__lorien/agents/chats", async (c) => {
    const idx = await listChats(opts.projectRoot)
    return c.json(idx)
  })

  app.get("/__lorien/agents/chats/:id", async (c) => {
    const id = c.req.param("id")
    const chat = await loadChat(opts.projectRoot, id)
    if (!chat) return c.json({ error: "not found" }, 404)
    return c.json(chat)
  })
}
```

- [ ] **Step 4: Run, confirm REST tests pass**

```
pnpm --filter @darrylondil/lorien-runtime test server
```

Expected: 4 REST tests pass. (No WS tests yet.)

- [ ] **Step 5: Commit**

```
git add packages/runtime/src/agent-broker/server.ts packages/runtime/src/agent-broker/server.test.ts
git commit -m "feat(runtime): mountAgentBroker REST — availability + chats list/get"
```

---

## Task 9: `attachAgentBroker` — WebSocket handler

Adds the WS upgrade handler that talks to subprocess driver. This is the most involved task.

**Files:**
- Modify: `packages/runtime/src/agent-broker/server.ts` (add `attachAgentBroker`)
- Modify: `packages/runtime/src/agent-broker/server.test.ts` (add WS tests)

- [ ] **Step 1: Write the failing WS test**

Append these tests to `packages/runtime/src/agent-broker/server.test.ts` (after the REST `describe` block):

```ts
import { createServer } from "node:http"
import { resolve as resolvePath } from "node:path"
import { serve } from "@hono/node-server"
import WebSocket from "ws"
import { attachAgentBroker } from "./server.js"
import type { ClientMsg, ServerMsg } from "./types.js"

const MOCK_CLI = resolvePath(
  import.meta.dirname,
  "__fixtures__",
  "mock-cli.ts",
)

interface RunningServer {
  port: number
  close(): Promise<void>
}

async function startTestServer(root: string): Promise<RunningServer> {
  const app = new Hono()
  mountAgentBroker(app, { projectRoot: root })
  const server = serve({ fetch: app.fetch, port: 0 }) as ReturnType<
    typeof createServer
  >
  attachAgentBroker({
    app,
    server,
    projectRoot: root,
    spawnOverride: () => ({
      command: process.execPath,
      argsOverride: ["--import", "tsx", MOCK_CLI],
    }),
  })
  await new Promise<void>((r) => server.on("listening", () => r()))
  const addr = server.address()
  if (!addr || typeof addr === "string") throw new Error("no address")
  return {
    port: addr.port,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r())
      }),
  }
}

function openWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/__lorien/agents/ws`, {
      origin: "http://localhost:5173",
    })
    ws.once("open", () => resolve(ws))
    ws.once("error", reject)
  })
}

async function nextServerMsg(ws: WebSocket): Promise<ServerMsg> {
  return new Promise((resolve, reject) => {
    const onMsg = (raw: WebSocket.RawData) => {
      ws.off("error", onErr)
      resolve(JSON.parse(String(raw)) as ServerMsg)
    }
    const onErr = (e: Error) => {
      ws.off("message", onMsg)
      reject(e)
    }
    ws.once("message", onMsg)
    ws.once("error", onErr)
  })
}

function send(ws: WebSocket, msg: ClientMsg): void {
  ws.send(JSON.stringify(msg))
}

describe("attachAgentBroker — WebSocket", () => {
  let root: string
  let server: RunningServer

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "lorien-broker-ws-"))
    server = await startTestServer(root)
  })

  afterEach(async () => {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  })

  it("new_chat returns a chat_created message with an id", async () => {
    const ws = await openWs(server.port)
    send(ws, { type: "new_chat", agent: "claude" })
    const msg = await nextServerMsg(ws)
    expect(msg.type).toBe("chat_created")
    if (msg.type === "chat_created") expect(msg.chatId).toMatch(/.+/)
    ws.close()
  })

  it("user message produces a stream of normalized events", async () => {
    const ws = await openWs(server.port)
    send(ws, { type: "new_chat", agent: "claude" })
    const created = (await nextServerMsg(ws)) as Extract<
      ServerMsg,
      { type: "chat_created" }
    >
    send(ws, { type: "user", chatId: created.chatId, text: "hi" })
    const kinds: string[] = []
    for (let i = 0; i < 4; i++) {
      const m = await nextServerMsg(ws)
      expect(m.type).toBe("event")
      if (m.type === "event") kinds.push(m.event.kind)
    }
    expect(kinds).toEqual([
      "assistant_text",
      "tool_use",
      "tool_result",
      "turn_done",
    ])
    ws.close()
  })

  it("rejects upgrade from non-loopback origin", async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${server.port}/__lorien/agents/ws`,
      { origin: "https://evil.example" },
    )
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => reject(new Error("should not open")))
      ws.on("unexpected-response", (_req, res) => {
        expect(res.statusCode).toBeGreaterThanOrEqual(400)
        resolve()
      })
      ws.on("error", () => resolve())
    })
  })

  it("cancel kills the subprocess and emits chat_closed", async () => {
    const ws = await openWs(server.port)
    send(ws, { type: "new_chat", agent: "claude" })
    const created = (await nextServerMsg(ws)) as Extract<
      ServerMsg,
      { type: "chat_created" }
    >
    send(ws, { type: "user", chatId: created.chatId, text: "hi" })
    // Consume the first event, then cancel.
    await nextServerMsg(ws)
    send(ws, { type: "cancel", chatId: created.chatId })
    // Drain until we see chat_closed (the in-flight events may arrive first).
    for (let i = 0; i < 20; i++) {
      const m = await nextServerMsg(ws)
      if (m.type === "chat_closed") {
        expect(m.reason).toBe("user_cancel")
        ws.close()
        return
      }
    }
    throw new Error("did not see chat_closed within 20 messages")
  })
})
```

- [ ] **Step 2: Run, expect failure**

```
pnpm --filter @darrylondil/lorien-runtime test server
```

Expected: WS tests fail (`attachAgentBroker is not exported`). REST tests still pass.

- [ ] **Step 3: Implement `attachAgentBroker`**

Replace `packages/runtime/src/agent-broker/server.ts` with:

```ts
import type { Server as HttpServer, IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import type { Hono } from "hono"
import { WebSocketServer, type WebSocket } from "ws"
import { AvailabilityProbe } from "./availability.js"
import {
  spawnClaude,
  type ClaudeProcess,
  type SpawnClaudeOptions,
} from "./subprocess.js"
import { SubscriberRegistry, type SocketLike } from "./subscribers.js"
import {
  appendChatEvent,
  createChat,
  listChats,
  loadChat,
} from "./transcript.js"
import type {
  AgentName,
  ClientMsg,
  ServerMsg,
} from "./types.js"

export interface MountAgentBrokerOptions {
  projectRoot: string
  /** Inject a custom probe in tests; defaults to the real one. */
  availability?: AvailabilityProbe
}

export function mountAgentBroker(
  app: Hono,
  opts: MountAgentBrokerOptions,
): void {
  const availability = opts.availability ?? new AvailabilityProbe()

  app.get("/__lorien/agents/availability", async (c) => {
    const r = await availability.probe()
    return c.json(r)
  })

  app.get("/__lorien/agents/chats", async (c) => {
    const idx = await listChats(opts.projectRoot)
    return c.json(idx)
  })

  app.get("/__lorien/agents/chats/:id", async (c) => {
    const id = c.req.param("id")
    const chat = await loadChat(opts.projectRoot, id)
    if (!chat) return c.json({ error: "not found" }, 404)
    return c.json(chat)
  })
}

export interface AttachAgentBrokerOptions {
  /** Same Hono app that was passed to mountAgentBroker. */
  app: Hono
  /** Node HTTP server (e.g. returned by @hono/node-server's `serve`). */
  server: HttpServer
  projectRoot: string
  /** Test injection: override spawnClaude args without touching production code. */
  spawnOverride?: () => Pick<SpawnClaudeOptions, "command" | "argsOverride">
}

const WS_PATH = "/__lorien/agents/ws"

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    const u = new URL(origin)
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "[::1]"
    )
  } catch {
    return false
  }
}

interface ChatLifecycle {
  proc: ClaudeProcess | null
  sessionId: string | null
}

export function attachAgentBroker(opts: AttachAgentBrokerOptions): void {
  const subs = new SubscriberRegistry()
  const chats = new Map<string, ChatLifecycle>()

  const wss = new WebSocketServer({ noServer: true })

  function asSocketLike(ws: WebSocket): SocketLike {
    return {
      send: (data) => ws.send(data),
      isOpen: () => ws.readyState === ws.OPEN,
    }
  }

  function emit(chatId: string, msg: ServerMsg): void {
    subs.broadcast(chatId, msg)
  }

  async function ensureChat(chatId: string): Promise<ChatLifecycle> {
    let c = chats.get(chatId)
    if (!c) {
      c = { proc: null, sessionId: null }
      chats.set(chatId, c)
    }
    return c
  }

  async function pumpProcess(
    chatId: string,
    proc: ClaudeProcess,
  ): Promise<void> {
    for await (const event of proc.events) {
      await appendChatEvent(opts.projectRoot, chatId, event).catch(() => {
        /* swallow disk errors — event already in flight to subscribers */
      })
      emit(chatId, { type: "event", chatId, event })
    }
  }

  async function startProcess(
    chatId: string,
    lifecycle: ChatLifecycle,
  ): Promise<ClaudeProcess> {
    const override = opts.spawnOverride?.()
    const proc = spawnClaude({
      chatId,
      projectRoot: opts.projectRoot,
      ...(lifecycle.sessionId !== null
        ? { resumeSessionId: lifecycle.sessionId }
        : {}),
      ...(override ?? {}),
    })
    lifecycle.proc = proc
    void pumpProcess(chatId, proc).catch(() => {
      /* iteration ended; close handled below */
    })
    proc.exit.then((code) => {
      // If we still have subscribers, tell them.
      const reason =
        chats.get(chatId)?.proc === proc ? "subprocess_exit" : "user_cancel"
      emit(chatId, { type: "chat_closed", chatId, reason })
      if (lifecycle.proc === proc) lifecycle.proc = null
      // Capture session id from the process for future resume.
      const sid = proc.sessionId()
      if (sid) lifecycle.sessionId = sid
      void code // unused
    })
    return proc
  }

  async function handleMessage(
    ws: WebSocket,
    raw: string,
  ): Promise<void> {
    let msg: ClientMsg
    try {
      msg = JSON.parse(raw) as ClientMsg
    } catch {
      return
    }

    switch (msg.type) {
      case "new_chat": {
        if (msg.agent !== "claude") {
          // Codex not implemented in this plan; respond with an error.
          ws.send(
            JSON.stringify({
              type: "agent_error",
              chatId: "",
              message: "Codex CLI integration is not implemented yet",
              recoverable: false,
            } satisfies ServerMsg),
          )
          return
        }
        const id = await createChat(opts.projectRoot, {
          agent: msg.agent as AgentName,
          title: "untitled",
        })
        subs.subscribe(id, asSocketLike(ws))
        ws.send(
          JSON.stringify({
            type: "chat_created",
            chatId: id,
          } satisfies ServerMsg),
        )
        return
      }
      case "open_chat": {
        subs.subscribe(msg.chatId, asSocketLike(ws))
        return
      }
      case "user": {
        const lifecycle = await ensureChat(msg.chatId)
        const event = {
          kind: "user_message" as const,
          text: msg.text,
          at: new Date().toISOString(),
        }
        await appendChatEvent(opts.projectRoot, msg.chatId, event).catch(
          () => undefined,
        )
        emit(msg.chatId, { type: "event", chatId: msg.chatId, event })

        if (!lifecycle.proc) {
          lifecycle.proc = await startProcess(msg.chatId, lifecycle)
        }
        lifecycle.proc.send(msg.text)
        return
      }
      case "cancel": {
        const lifecycle = chats.get(msg.chatId)
        if (lifecycle?.proc) {
          lifecycle.proc.kill()
          lifecycle.proc = null
        }
        emit(msg.chatId, {
          type: "chat_closed",
          chatId: msg.chatId,
          reason: "user_cancel",
        })
        return
      }
    }
  }

  wss.on("connection", (ws) => {
    const socket = asSocketLike(ws)
    ws.on("message", (data) => {
      void handleMessage(ws, String(data))
    })
    ws.on("close", () => {
      subs.unsubscribeAll(socket)
      // If no subscribers remain for any chat with a live process, kill the process.
      for (const [id, lifecycle] of chats) {
        if (lifecycle.proc && !subs.isAnyOnline(id)) {
          lifecycle.proc.kill()
          lifecycle.proc = null
        }
      }
    })
  })

  opts.server.on(
    "upgrade",
    (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = req.url ?? ""
      if (!url.startsWith(WS_PATH)) return
      const origin = req.headers.origin
      if (!isLoopbackOrigin(origin)) {
        socket.write(
          "HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n",
        )
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req)
      })
    },
  )
}
```

- [ ] **Step 4: Run all server tests, confirm pass**

```
pnpm --filter @darrylondil/lorien-runtime test server
```

Expected: REST tests still pass; the 4 new WS tests pass. The `cancel` test has a loose poll loop because of in-flight events — that's deliberate.

- [ ] **Step 5: Commit**

```
git add packages/runtime/src/agent-broker/server.ts packages/runtime/src/agent-broker/server.test.ts
git commit -m "feat(runtime): WebSocket broker — new_chat, user, cancel, loopback guard"
```

---

## Task 10: Export from runtime + update server template

Make the broker discoverable from the runtime's public API and update the scaffolded `src/server.ts` template so new projects automatically wire it.

**Files:**
- Modify: `packages/runtime/src/index.ts`
- Modify: `packages/runtime/tsup.config.ts`
- Modify: `packages/create-lorien-api/src/templates.ts`
- Modify: `packages/create-lorien-api/src/templates.test.ts`

- [ ] **Step 1: Add agent-broker entry to runtime tsup**

Edit `packages/runtime/tsup.config.ts`. Replace its contents with:

```ts
import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "testing/index": "src/testing/index.ts",
    "agent-broker/index": "src/agent-broker/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: false,
})
```

- [ ] **Step 2: Create `packages/runtime/src/agent-broker/index.ts`**

This is a slim re-export file:

```ts
export type {
  AgentAvailability,
  AgentEvent,
  AgentName,
  AvailabilityResponse,
  ChatIndex,
  ChatIndexEntry,
  ChatTranscript,
  ClientMsg,
  ServerMsg,
  ToolKind,
} from "./types.js"
export { AvailabilityProbe } from "./availability.js"
export {
  appendChatEvent,
  createChat,
  listChats,
  loadChat,
  TranscriptStore,
} from "./transcript.js"
export { attachAgentBroker, mountAgentBroker } from "./server.js"
export type {
  AttachAgentBrokerOptions,
  MountAgentBrokerOptions,
} from "./server.js"
```

- [ ] **Step 3: Add to package.json `exports`**

Edit `packages/runtime/package.json` and replace the `exports` block with:

```jsonc
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing/index.d.ts",
      "default": "./dist/testing/index.js"
    },
    "./agent-broker": {
      "types": "./dist/agent-broker/index.d.ts",
      "default": "./dist/agent-broker/index.js"
    }
  },
```

- [ ] **Step 4: Update the scaffolded `server.ts` template**

Edit `packages/create-lorien-api/src/templates.ts`. Replace `renderServerEntry` with:

```ts
export function renderServerEntry(): string {
  return `import { serve } from "@hono/node-server"
import { startLorienServer } from "@darrylondil/lorien-runtime"
import { attachAgentBroker, mountAgentBroker } from "@darrylondil/lorien-runtime/agent-broker"

const app = await startLorienServer()
mountAgentBroker(app, { projectRoot: process.cwd() })

const port = Number(process.env.PORT) || 3000
const server = serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(\`lorien-api listening on http://localhost:\${port}\`)
})
attachAgentBroker({ app, server, projectRoot: process.cwd() })
`
}
```

- [ ] **Step 5: Update the template test to reflect the new server.ts shape**

Edit the `"server.ts uses startLorienServer + serve"` test in `packages/create-lorien-api/src/templates.test.ts`. Replace it with:

```ts
  it("server.ts uses startLorienServer + serve + agent broker", () => {
    const out = renderServerEntry()
    expect(out).toMatch(/startLorienServer/)
    expect(out).toMatch(/@hono\/node-server/)
    expect(out).toMatch(/mountAgentBroker/)
    expect(out).toMatch(/attachAgentBroker/)
  })
```

- [ ] **Step 6: Run the create-lorien-api tests, confirm pass**

```
pnpm --filter create-lorien test
```

Expected: all tests pass.

- [ ] **Step 7: Run the runtime tests, confirm pass**

```
pnpm --filter @darrylondil/lorien-runtime test
```

Expected: all tests pass.

- [ ] **Step 8: Build runtime to verify the new export path works**

```
pnpm --filter @darrylondil/lorien-runtime build
```

Expected: clean build; `dist/agent-broker/index.js` and `dist/agent-broker/index.d.ts` exist.

```
ls /c/Users/hello/source/cozy-api/packages/runtime/dist/agent-broker
```

- [ ] **Step 9: Commit**

```
git add packages/runtime/src/agent-broker/index.ts packages/runtime/tsup.config.ts packages/runtime/package.json packages/create-lorien-api/src/templates.ts packages/create-lorien-api/src/templates.test.ts
git commit -m "feat(runtime+create-lorien): export agent-broker subpath; scaffold wires it"
```

---

## Task 11: End-to-end smoke against a real scaffolded project

Operational verification. Scaffold a project via the built `create-lorien-api`, install deps, start the dev server, open a WebSocket, send a message, confirm events stream back. This is the "does it actually work end-to-end" gate.

**Files:** No code changes; this is operational.

**Pre-requisites:**
- `claude` CLI must be installed and authed on the machine running the smoke (else the subprocess spawn will fail and the test only validates plumbing up to the spawn).
- If `claude` is NOT installed, the smoke proves the broker mounts and rejects/errors gracefully — also a valid result.

- [ ] **Step 1: Build the runtime + create-lorien**

```
pnpm --filter @darrylondil/lorien-runtime build
pnpm --filter create-lorien build
```

Both should exit 0.

- [ ] **Step 2: Scaffold a smoke project and install deps**

In PowerShell:

```powershell
$repo = (Get-Location).Path
$tmp = Join-Path $env:TEMP "lorien-broker-smoke-$([guid]::NewGuid().ToString().Substring(0,8))"
New-Item -ItemType Directory -Path $tmp | Out-Null
Push-Location $tmp
try {
  node "$repo/packages/create-lorien-api/dist/cli.js" broker-app --skip-install
  Push-Location "broker-app"
  pnpm install
  Pop-Location
} finally {
  Pop-Location
}
```

Expected: `$tmp/broker-app/` exists with `node_modules` populated; `src/server.ts` contains both `mountAgentBroker` and `attachAgentBroker` calls.

- [ ] **Step 3: Start the dev server**

```powershell
$proj = "$tmp/broker-app"
# Use the workspace's local runtime build, not the published version.
# (For a smoke test, easiest path: use tsx to run server.ts.)
Push-Location $proj
$serverProc = Start-Process -PassThru -NoNewWindow -RedirectStandardOutput "$proj/server.log" -FilePath "npx" -ArgumentList "tsx", "src/server.ts"
Pop-Location
Start-Sleep -Seconds 3
Get-Content "$proj/server.log"
```

Expected output (or similar): `lorien-api listening on http://localhost:3000`.

- [ ] **Step 4: Hit the availability endpoint**

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3000/__lorien/agents/availability"
```

Expected: JSON response with `claude` and `codex` keys, each having `installed` boolean (true if claude is installed on the machine).

- [ ] **Step 5: Open a WebSocket and run one chat turn**

Use a tiny inline Node script (no permanent file needed):

```powershell
node -e "import('ws').then(({default:WS})=>{const ws=new WS('ws://127.0.0.1:3000/__lorien/agents/ws',{origin:'http://localhost:5173'});ws.on('open',()=>{console.log('connected');ws.send(JSON.stringify({type:'new_chat',agent:'claude'}))});ws.on('message',m=>{const x=JSON.parse(String(m));console.log('recv:',x.type,x.event?.kind??'');if(x.type==='chat_created'){ws.send(JSON.stringify({type:'user',chatId:x.chatId,text:'say hi'}))}});setTimeout(()=>process.exit(0),15000)});"
```

Expected:
- `connected`
- `recv: chat_created`
- `recv: event user_message`
- Several `recv: event <kind>` lines (assistant_text, tool_use, etc., depending on Claude's actual response — won't match the mock-cli fixture in real-world use)
- Eventually `recv: chat_closed` or process times out at 15s.

If `claude` is NOT installed on the machine, the `user` send will produce `agent_error`; that's also a valid outcome and proves the error path.

- [ ] **Step 6: Tear down**

```powershell
Stop-Process -Id $serverProc.Id -Force
Remove-Item -Recurse -Force $tmp
```

- [ ] **Step 7: No commit**

This task is operational only.

---

## Done criteria

All checked:

- [ ] `pnpm --filter @darrylondil/lorien-runtime test` — all green (including the integration tests in `server.test.ts`).
- [ ] `pnpm --filter @darrylondil/lorien-runtime typecheck` — clean.
- [ ] `pnpm --filter @darrylondil/lorien-runtime build` — clean; `dist/agent-broker/index.{js,d.ts}` produced.
- [ ] `pnpm --filter create-lorien test` — all green; `server.ts` template now includes broker wiring.
- [ ] Smoke (Task 11) demonstrates the WS protocol end-to-end against a real or mock CLI.
- [ ] 10 commits on the branch (one per task 1–10; task 11 is operational).

---

## What this plan does NOT do (deferred)

- **No Codex integration.** Returns `agent_error: not implemented` on `new_chat { agent: "codex" }`. Availability honestly reports `codex.installed` based on PATH but no normalizer / no subprocess driver exists.
- **No shell approval UI loop.** v1 uses `--permission-mode bypassPermissions`. Inline approval cards land in Plan C.
- **No WS replay-on-reconnect.** Browser reconnect = REST re-fetch the transcript. `eventSeq` / `replay` server messages spec'd in §4.2 are not implemented.
- **No per-chat title auto-generation.** Chats are created with `title: "untitled"`. Plan C will update the title on first user message.
- **No multi-project workspace.** Single project root per broker.
- **No telemetry, no rate limiting, no quotas.**
