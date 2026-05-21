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
