import type { Command } from "commander"

export function registerDev(program: Command): void {
  program
    .command("dev")
    .description("Start the dev server (tsx src/server.ts)")
    .option("--root <path>", "project root", process.cwd())
    .action(async (_opts) => {
      console.log("cozy dev not yet implemented (Plan #2 Task 3)")
    })
}
