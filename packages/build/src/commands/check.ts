import { resolve } from "node:path"
import type { Command } from "commander"
import { type CheckResult, formatFinding, runCheck } from "../check/run-check.js"

export interface CheckCommandOptions {
  root: string
  json?: boolean
  /** Fail on warnings too. */
  strict?: boolean
}

export function registerCheck(program: Command): void {
  program
    .command("check")
    .description(
      "Check that providers, nodes and middleware sit where lorien expects, and say where misplaced code should go",
    )
    .option("--root <path>", "project root", process.cwd())
    .option("--json", "print findings as JSON")
    .option("--strict", "fail on warnings as well as errors")
    .action(async (opts: CheckCommandOptions) => {
      const { exitCode } = await runCheckCommand(opts)
      process.exit(exitCode)
    })
}

export async function runCheckCommand(
  opts: CheckCommandOptions,
  log: (line: string) => void = (line) => console.log(line),
): Promise<CheckResult & { exitCode: number }> {
  const result = await runCheck(resolve(opts.root))
  if (opts.json) {
    log(JSON.stringify(result, null, 2))
  } else {
    for (const f of result.findings) log(formatFinding(f))
    if (result.findings.length > 0) log("")
    log(checkSummary(result))
  }
  const failed = result.errors > 0 || (opts.strict === true && result.warnings > 0)
  return { ...result, exitCode: failed ? 1 : 0 }
}

export function checkSummary(result: CheckResult): string {
  if (result.findings.length === 0) return "✓ lorien check: everything is where it belongs"
  return `lorien check: ${result.errors} error(s), ${result.warnings} warning(s)`
}
