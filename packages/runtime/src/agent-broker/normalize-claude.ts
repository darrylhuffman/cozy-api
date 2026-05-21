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

const SUMMARY_MAX_CHARS = 200

/**
 * Extract a string summary from Claude's tool_result.content, which may be:
 * - a plain string
 * - an array of content blocks like [{ type: "text", text: "..." }]
 * - anything else (returns undefined)
 *
 * Truncates to SUMMARY_MAX_CHARS for UI display.
 */
function extractToolResultSummary(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content.slice(0, SUMMARY_MAX_CHARS)
  }
  if (Array.isArray(content)) {
    const text = content
      .filter(
        (block): block is { type: string; text: string } =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string",
      )
      .map((block) => block.text)
      .join("")
    return text.length > 0 ? text.slice(0, SUMMARY_MAX_CHARS) : undefined
  }
  return undefined
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
        const summary = extractToolResultSummary(b.content)
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
