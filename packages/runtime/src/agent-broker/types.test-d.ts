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
