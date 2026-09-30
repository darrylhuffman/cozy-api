import type { Command } from "commander"
import { runBuild } from "../build/run-build.js"
import { registerTsxFromWorkspace } from "./ide.js"

export interface BuildOptions {
  root: string
  outDir: string
  skipTypes?: boolean
  bundle?: boolean
  typecheck?: boolean
}

export function registerBuild(program: Command): void {
  program
    .command("build")
    .description("Generate dist/ from workflows/ and nodes/")
    .option("--root <path>", "project root", process.cwd())
    .option("--outDir <path>", "output directory", "./dist")
    .option("--skip-types", "skip services type generation")
    .option("--no-bundle", "only generate TypeScript; don't compile dist/index.js")
    .option("--typecheck", "run tsc --noEmit first; type errors fail the build")
    .action(async (opts: BuildOptions) => {
      // lorien.config.ts and nodes are TypeScript; Node < 22.18 can't import them without a loader.
      await registerTsxFromWorkspace(opts.root)
      const result = await runBuild(opts)
      if (!result.ok) process.exit(1)
    })
}
