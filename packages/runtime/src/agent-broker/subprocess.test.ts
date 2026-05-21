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
