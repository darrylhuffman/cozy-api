import { spawn } from "node:child_process"
import { stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { Command } from "commander"
import { runIde } from "./ide.js"

export interface DevOptions {
  root: string
}

export function registerDev(program: Command): void {
  program
    .command("dev")
    .description("Start the dev server and open the IDE (use --no-ide to skip the IDE)")
    .option("--root <path>", "project root", process.cwd())
    .option("--no-ide", "skip the IDE — just run the dev server")
    .option("--ide-port <number>", "port for the IDE static server", "3737")
    .action(async (opts: { root: string; ide: boolean; idePort: string }) => {
      const root = resolve(opts.root)
      if (opts.ide === false) {
        const r = await runDevServer({ root })
        process.exit(r.exitCode ?? 1)
      } else {
        const r = await runDevWithIde({ root, idePort: parseInt(opts.idePort, 10) })
        process.exit(r.exitCode ?? 1)
      }
    })

  program
    .command("dev:server")
    .description("Start only the dev server (no IDE)")
    .option("--root <path>", "project root", process.cwd())
    .action(async (opts: DevOptions) => {
      const root = resolve(opts.root)
      const r = await runDevServer({ root })
      process.exit(r.exitCode ?? 1)
    })
}

export interface RunDevOptions {
  root: string
  /** For tests: inject a different spawn implementation. */
  spawnImpl?: typeof spawn
}

export interface RunDevResult {
  exitCode: number | null
  error?: string
}

export async function runDevServer(opts: RunDevOptions): Promise<RunDevResult> {
  const entry = join(opts.root, "src", "server.ts")
  if (!(await fileExists(entry))) {
    console.error(`lorien dev: cannot find ${entry}`)
    console.error("Make sure you're running from your lorien project root,")
    console.error("or pass --root <path>.")
    return { exitCode: 1, error: "entry-not-found" }
  }

  const spawnFn = opts.spawnImpl ?? spawn
  return new Promise<RunDevResult>((resolveResult) => {
    const child = spawnFn("tsx", [entry], {
      cwd: opts.root,
      stdio: "inherit",
      shell: process.platform === "win32",
    })
    child.on("error", (err: Error) => {
      console.error(`lorien dev: failed to spawn tsx — ${err.message}`)
      console.error(
        "Is tsx installed? Run `pnpm add -D tsx` (or your package manager's equivalent).",
      )
      resolveResult({ exitCode: 1, error: err.message })
    })
    child.on("close", (code: number | null) => {
      resolveResult({ exitCode: code })
    })
  })
}

export async function runDevWithIde(opts: {
  root: string
  idePort: number
  spawnImpl?: typeof spawn
}): Promise<RunDevResult> {
  // Start the IDE static server first; it stays alive in the background.
  try {
    await runIde({ port: opts.idePort, open: true })
  } catch (e) {
    console.error(`Could not start the IDE: ${(e as Error).message}`)
    console.error("Falling back to dev-server-only.")
    return runDevServer({ root: opts.root, spawnImpl: opts.spawnImpl })
  }

  console.log("Both services started. Ctrl-C to stop.")
  // Then start the dev server — tsx logs alongside the IDE startup line.
  return runDevServer({ root: opts.root, spawnImpl: opts.spawnImpl })
}

/** Keep the old export name as an alias so any external callers aren't broken. */
export const runDev = runDevServer

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    return s.isFile()
  } catch {
    return false
  }
}
