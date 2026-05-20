import type { Command } from "commander"

export function registerBuild(program: Command): void {
  program
    .command("build")
    .description("Generate dist/ from workflows/ and nodes/")
    .option("--root <path>", "project root", process.cwd())
    .option("--outDir <path>", "output directory", "./dist")
    .option("--skip-types", "skip services type generation")
    .action(async (_opts) => {
      console.log("cozy build not yet implemented (Plan #2 Task 10)")
    })
}
