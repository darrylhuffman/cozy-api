import { spawn } from "node:child_process"
import { stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { Command } from "commander"

export interface DevOptions {
  root: string
}

export function registerDev(program: Command): void {
  program
    .command("dev")
    .description("Start the dev server (tsx src/server.ts)")
    .option("--root <path>", "project root", process.cwd())
    .action(async (opts: DevOptions) => {
      const root = resolve(opts.root)
      const result = await runDev({ root })
      process.exit(result.exitCode ?? 1)
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

export async function runDev(opts: RunDevOptions): Promise<RunDevResult> {
  const entry = join(opts.root, "src", "server.ts")
  if (!(await fileExists(entry))) {
    console.error(`cozy dev: cannot find ${entry}`)
    console.error("Make sure you're running from your cozy-api project root,")
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
      console.error(`cozy dev: failed to spawn tsx — ${err.message}`)
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

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    return s.isFile()
  } catch {
    return false
  }
}
