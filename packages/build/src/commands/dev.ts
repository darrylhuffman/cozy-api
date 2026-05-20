import { spawn } from "node:child_process"
import { stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { Command } from "commander"
import { findAvailablePort, parseStartingPort } from "../ports.js"
import { DEFAULT_IDE_PORT, runIde } from "./ide.js"

export const DEFAULT_API_PORT = 3000

export interface DevOptions {
  root: string
  port: string
}

export function registerDev(program: Command): void {
  program
    .command("dev")
    .description("Start the dev server and open the IDE (use --no-ide to skip the IDE)")
    .option("--root <path>", "project root", process.cwd())
    .option(
      "--port <number>",
      "starting port for the API dev server",
      process.env.PORT ?? String(DEFAULT_API_PORT),
    )
    .option("--no-ide", "skip the IDE — just run the dev server")
    .option(
      "--ide-port <number>",
      "starting port for the IDE static server",
      String(DEFAULT_IDE_PORT),
    )
    .action(async (opts: { root: string; port: string; ide: boolean; idePort: string }) => {
      const root = resolve(opts.root)
      const port = parseStartingPort(opts.port, DEFAULT_API_PORT)
      if (opts.ide === false) {
        const r = await runDevServer({ root, port })
        process.exit(r.exitCode ?? 1)
      } else {
        const r = await runDevWithIde({
          root,
          port,
          idePort: parseStartingPort(opts.idePort, DEFAULT_IDE_PORT),
        })
        process.exit(r.exitCode ?? 1)
      }
    })

  program
    .command("dev:server")
    .description("Start only the dev server (no IDE)")
    .option("--root <path>", "project root", process.cwd())
    .option(
      "--port <number>",
      "starting port for the API dev server",
      process.env.PORT ?? String(DEFAULT_API_PORT),
    )
    .action(async (opts: DevOptions) => {
      const root = resolve(opts.root)
      const r = await runDevServer({ root, port: parseStartingPort(opts.port, DEFAULT_API_PORT) })
      process.exit(r.exitCode ?? 1)
    })
}

export interface RunDevOptions {
  root: string
  port?: number
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

  const requestedPort = parseStartingPort(opts.port ?? process.env.PORT, DEFAULT_API_PORT)
  const port = await findAvailablePort(requestedPort)
  if (port !== requestedPort) {
    console.log(`lorien dev: API port ${requestedPort} is busy; using ${port}.`)
  }

  const spawnFn = opts.spawnImpl ?? spawn
  return new Promise<RunDevResult>((resolveResult) => {
    const child = spawnFn("tsx", [entry], {
      cwd: opts.root,
      env: { ...process.env, PORT: String(port) },
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
  port?: number
  idePort: number
  spawnImpl?: typeof spawn
}): Promise<RunDevResult> {
  const devOpts: { root: string; port?: number; spawnImpl?: typeof spawn } = { root: opts.root }
  if (opts.port !== undefined) devOpts.port = opts.port
  if (opts.spawnImpl !== undefined) devOpts.spawnImpl = opts.spawnImpl

  // Start the IDE static server first; it stays alive in the background.
  try {
    await runIde({ port: opts.idePort, open: true })
  } catch (e) {
    console.error(`Could not start the IDE: ${(e as Error).message}`)
    console.error("Falling back to dev-server-only.")
    return runDevServer(devOpts)
  }

  console.log("Both services started. Ctrl-C to stop.")
  // Then start the dev server — tsx logs alongside the IDE startup line.
  return runDevServer(devOpts)
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
