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
