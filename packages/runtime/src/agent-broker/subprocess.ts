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
  /** Last ~2KB of stderr captured from the subprocess, for diagnostics. */
  stderrTail(): string
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
    // `shell: true` on Windows resolves `.cmd`/`.bat` shims used by npm-installed
    // global CLIs (claude.cmd, codex.cmd). All args are framework-controlled
    // literals, so no shell-injection surface.
    shell: process.platform === "win32",
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

  // Buffer the tail of stderr so we can surface it in agent_error messages
  // when the subprocess exits without useful stdout (e.g. auth errors).
  const STDERR_MAX = 2048
  let stderrBuf = ""
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderrBuf += chunk.toString()
    if (stderrBuf.length > STDERR_MAX) {
      stderrBuf = stderrBuf.slice(-STDERR_MAX)
    }
  })

  const rl = createInterface({ input: child.stdout })
  rl.on("line", (line) => {
    const sid = extractClaudeSessionId(line)
    if (sid) sessionId = sid
    for (const ev of normalizeClaude(line)) push(ev)
  })
  rl.on("close", finish)
  child.on("error", (err) => {
    // Spawn-time errors (ENOENT, EACCES) arrive here, never on stderr.
    stderrBuf = `${stderrBuf}\n${err instanceof Error ? err.message : String(err)}`.slice(
      -STDERR_MAX,
    )
    finish()
  })

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
    stderrTail: () => stderrBuf.trim(),
  }
}
