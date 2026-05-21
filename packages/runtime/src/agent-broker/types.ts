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
