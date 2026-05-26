// packages/runtime/src/dev-server/console-capture.ts
import { AsyncLocalStorage } from "node:async_hooks"

interface RunContext {
  runId: string
}

const runContext = new AsyncLocalStorage<RunContext>()

/** Sentinel property stamped onto our wrapper functions so we can detect if the
 *  patch is already in place (e.g. after a test's afterEach restores originals). */
const PATCHED_TAG = "__lorien_console_capture__"

let handler:
  | ((e: { runId: string; level: "log" | "info" | "warn" | "error"; message: string }) => void)
  | null = null

export function installConsoleCapture(
  onLog: NonNullable<typeof handler>,
): void {
  handler = onLog

  // If the current console.log is already our wrapper, don't double-wrap.
  // If it's been restored (e.g. by a test afterEach), re-install.
  if ((console.log as unknown as Record<string, unknown>)[PATCHED_TAG]) return

  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  }
  const levels = ["log", "info", "warn", "error"] as const
  for (const level of levels) {
    const wrapper = (...args: unknown[]) => {
      const ctx = runContext.getStore()
      if (ctx && handler) {
        const message = args.map(formatArg).join(" ")
        handler({ runId: ctx.runId, level, message })
      }
      original[level](...args)
    }
    ;(wrapper as unknown as Record<string, unknown>)[PATCHED_TAG] = true
    console[level] = wrapper
  }
}

export function withRunContext<T>(
  runId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runContext.run({ runId }, fn)
}

function formatArg(a: unknown): string {
  if (a instanceof Error) return a.stack ?? a.message
  if (typeof a === "string") return a
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}
