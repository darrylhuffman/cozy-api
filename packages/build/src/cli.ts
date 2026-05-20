import { Command } from "commander"
import { registerBuild } from "./commands/build.js"
import { registerDev } from "./commands/dev.js"
import { registerIde } from "./commands/ide.js"
import { registerImportOpenapi } from "./commands/import-openapi.js"
import { registerInit } from "./commands/init.js"

const VERSION = "0.0.0"

function createProgram(): Command {
  const program = new Command()
  program
    .name("lorien")
    .description("Build, dev, and OpenAPI tools for lorien projects")
    .version(VERSION)

  registerBuild(program)
  registerDev(program)
  registerIde(program)
  registerInit(program)
  registerImportOpenapi(program)

  return program
}

async function main(argv: string[] = process.argv): Promise<void> {
  const program = createProgram()
  await program.parseAsync(argv)
}

// Only execute when this module is the direct entry point (not when imported by tests)
const isMain =
  process.argv[1] != null &&
  import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href

if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

// Exported for tests
export { createProgram, VERSION }
