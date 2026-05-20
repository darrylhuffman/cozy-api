import type { Command } from "commander"

export function registerImportOpenapi(program: Command): void {
  program
    .command("import-openapi")
    .description("Generate client nodes from an OpenAPI spec (Plan #3)")
    .argument("<spec>", "path to OpenAPI JSON spec")
    .action(async (_spec) => {
      console.log("cozy import-openapi not yet implemented (Plan #3, @cozy/openapi)")
    })
}
