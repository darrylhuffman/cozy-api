import { resolve } from "node:path"
import { startLorienServer } from "@darrylondil/lorien-runtime"
import {
  type CollectionRunResult,
  failureSummary,
  type RunRequestCollectionsOptions,
  runRequestCollections,
} from "@darrylondil/lorien-runtime/testing"
import type { Command } from "commander"
import { registerTsxFromWorkspace } from "./ide.js"

export interface TestCommandOptions {
  root: string
  env?: string
  baseUrl?: string
  json?: boolean
  filter?: string
}

export interface RunTestDeps {
  /** Builds the in-process app. Defaults to the workspace's lorien server. */
  startApp?: (root: string) => Promise<NonNullable<RunRequestCollectionsOptions["app"]>>
  log?: (line: string) => void
}

export interface RunTestResult {
  exitCode: number
  passed: number
  failed: number
  runs: CollectionRunResult[]
}

export function registerTest(program: Command): void {
  program
    .command("test")
    .description(
      "Run the saved API requests (workflows/**/*.requests.json) and check their assertions",
    )
    .argument("[filter]", "only run collections whose path contains this text")
    .option("--root <path>", "project root", process.cwd())
    .option("--env <name>", "environment from lorien.environments.json")
    .option(
      "--base-url <url>",
      "send real HTTP to a running server instead of running the workflows in-process",
    )
    .option("--json", "print results as JSON")
    .action(async (filter: string | undefined, opts: TestCommandOptions) => {
      const r = await runTest({ ...opts, ...(filter ? { filter } : {}) })
      process.exit(r.exitCode)
    })
}

async function defaultStartApp(root: string) {
  await registerTsxFromWorkspace(root)
  return startLorienServer({ root })
}

export async function runTest(
  opts: TestCommandOptions,
  deps: RunTestDeps = {},
): Promise<RunTestResult> {
  const root = resolve(opts.root)
  const log = deps.log ?? ((line: string) => console.log(line))
  let runs: CollectionRunResult[]
  try {
    const app = opts.baseUrl ? undefined : await (deps.startApp ?? defaultStartApp)(root)
    runs = await runRequestCollections({
      root,
      ...(opts.env ? { env: opts.env } : {}),
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      ...(app ? { app } : {}),
      ...(opts.filter ? { filter: opts.filter } : {}),
    })
  } catch (e) {
    log(`lorien test: ${(e as Error).message}`)
    return { exitCode: 1, passed: 0, failed: 0, runs: [] }
  }

  let passed = 0
  let failed = 0
  for (const run of runs) {
    if (run.error) failed++
    for (const r of run.results) r.passed ? passed++ : failed++
  }

  if (opts.json) {
    log(JSON.stringify({ passed, failed, runs }, null, 2))
  } else if (runs.length === 0) {
    log(
      "No saved requests found. Save one from the IDE's Run tab (it writes workflows/**/*.requests.json).",
    )
  } else {
    for (const run of runs) {
      log(run.path)
      if (run.error) log(`  ✗ ${run.error}`)
      for (const r of run.results) {
        const ms = r.response ? ` (${r.response.durationMs}ms)` : ""
        log(`  ${r.passed ? "✓" : "✗"} ${r.name}${ms}`)
        for (const reason of failureSummary(r)) log(`      ${reason}`)
      }
    }
    log("")
    log(`${passed} passed, ${failed} failed`)
  }
  return { exitCode: failed > 0 ? 1 : 0, passed, failed, runs }
}
