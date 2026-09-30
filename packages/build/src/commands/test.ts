import { resolve } from "node:path"
import { startLorienServer } from "@darrylondil/lorien-runtime"
import {
  type CollectionRunResult,
  failureSummary,
  type NodeCaseFileResult,
  type RunRequestCollectionsOptions,
  runNodeCases,
  runRequestCollections,
} from "@darrylondil/lorien-runtime/testing"
import type { Command } from "commander"
import { formatFinding, runCheck } from "../check/run-check.js"
import { checkSummary } from "./check.js"
import { registerTsxFromWorkspace } from "./ide.js"

export interface TestCommandOptions {
  root: string
  env?: string
  baseUrl?: string
  json?: boolean
  filter?: string
  /** commander's --no-requests / --no-nodes */
  requests?: boolean
  nodes?: boolean
}

export interface RunTestDeps {
  /** Builds the in-process app. Defaults to the workspace's lorien server. */
  startApp?: (root: string) => Promise<NonNullable<RunRequestCollectionsOptions["app"]>>
  /** Runs node cases. Defaults to importing the workspace's nodes in-process. */
  runCases?: (root: string, filter?: string) => Promise<NodeCaseFileResult[]>
  log?: (line: string) => void
}

export interface RunTestResult {
  exitCode: number
  passed: number
  failed: number
  runs: CollectionRunResult[]
  nodeCases: NodeCaseFileResult[]
}

export function registerTest(program: Command): void {
  program
    .command("test")
    .description(
      "Run node test cases (nodes/**/*.cases.json) and saved API requests (workflows/**/*.requests.json)",
    )
    .argument("[filter]", "only run collections whose path contains this text")
    .option("--root <path>", "project root", process.cwd())
    .option("--env <name>", "environment from lorien.environments.json")
    .option(
      "--base-url <url>",
      "send real HTTP to a running server instead of running the workflows in-process",
    )
    .option("--json", "print results as JSON")
    .option("--no-requests", "skip saved API requests")
    .option("--no-nodes", "skip node test cases")
    .action(async (filter: string | undefined, opts: TestCommandOptions) => {
      const r = await runTest({ ...opts, ...(filter ? { filter } : {}) })
      process.exit(r.exitCode)
    })
}

async function defaultStartApp(root: string) {
  await registerTsxFromWorkspace(root)
  return startLorienServer({ root, testHooks: true })
}

async function defaultRunCases(root: string, filter?: string) {
  await registerTsxFromWorkspace(root)
  return runNodeCases({ root, ...(filter ? { filter } : {}) })
}

export async function runTest(
  opts: TestCommandOptions,
  deps: RunTestDeps = {},
): Promise<RunTestResult> {
  const root = resolve(opts.root)
  const log = deps.log ?? ((line: string) => console.log(line))
  let runs: CollectionRunResult[] = []
  let nodeCases: NodeCaseFileResult[] = []

  // lorien check first: an error (a duplicate selector, a singleton using a
  // scoped provider) fails the run; warnings are printed and don't.
  const check = await runCheck(root)
  if (!opts.json && check.findings.length > 0) {
    for (const f of check.findings) log(formatFinding(f))
    log(checkSummary(check))
    log("")
  }

  try {
    if (opts.nodes !== false) {
      nodeCases = await (deps.runCases ?? defaultRunCases)(root, opts.filter)
    }
    if (opts.requests !== false) {
      const app = opts.baseUrl ? undefined : await (deps.startApp ?? defaultStartApp)(root)
      runs = await runRequestCollections({
        root,
        ...(opts.env ? { env: opts.env } : {}),
        ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
        ...(app ? { app } : {}),
        ...(opts.filter ? { filter: opts.filter } : {}),
      })
    }
  } catch (e) {
    log(`lorien test: ${(e as Error).message}`)
    return { exitCode: 1, passed: 0, failed: 0, runs, nodeCases }
  }

  let passed = 0
  let failed = 0
  for (const f of [...nodeCases, ...runs]) {
    if (f.error) failed++
    for (const r of f.results) r.passed ? passed++ : failed++
  }

  if (opts.json) {
    log(JSON.stringify({ passed, failed, check: check.findings, nodeCases, runs }, null, 2))
  } else if (runs.length === 0 && nodeCases.length === 0) {
    log(
      "No tests found. Add node cases from the IDE's Tests tab (nodes/**/*.cases.json) or save requests from the Run tab (workflows/**/*.requests.json).",
    )
  } else {
    for (const f of nodeCases) {
      log(f.path)
      if (f.error) log(`  ✗ ${f.error}`)
      for (const r of f.results) {
        log(`  ${r.passed ? "✓" : "✗"} ${r.name} (${r.durationMs}ms)`)
        for (const reason of r.failures) log(`      ${reason}`)
      }
    }
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
  return { exitCode: failed > 0 || check.errors > 0 ? 1 : 0, passed, failed, runs, nodeCases }
}
