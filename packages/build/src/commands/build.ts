import type { Command } from "commander"
import { runBuild } from "../build/run-build.js"

export interface BuildOptions {
  root: string
  outDir: string
  skipTypes?: boolean
}

export function registerBuild(program: Command): void {
  program
    .command("build")
    .description("Generate dist/ from workflows/ and nodes/")
    .option("--root <path>", "project root", process.cwd())
    .option("--outDir <path>", "output directory", "./dist")
    .option("--skip-types", "skip services type generation")
    .action(async (opts: BuildOptions) => {
      const result = await runBuild(opts)
      if (!result.ok) process.exit(1)
    })
}
