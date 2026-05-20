import type { Command } from "commander"

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Add AGENTS.md to the current project")
    .option("--force", "overwrite if AGENTS.md exists")
    .action(async (_opts) => {
      console.log("cozy init not yet implemented (Plan #2 Task 4)")
    })
}
