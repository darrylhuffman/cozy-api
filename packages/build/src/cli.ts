import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { Command } from "commander"
import { registerBuild } from "./commands/build.js"
import { registerDev } from "./commands/dev.js"
import { registerIde } from "./commands/ide.js"
import { registerImportOpenapi } from "./commands/import-openapi.js"
import { registerInit } from "./commands/init.js"
import { registerTest } from "./commands/test.js"
import { registerTypes } from "./commands/types.js"

/** This package's version; dist/cli.js and src/cli.ts both sit one level below package.json. */
const VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version

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
  registerTest(program)
  registerTypes(program)

  return program
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createProgram()
  await program.parseAsync(argv)
}

/**
 * True when `moduleUrl` is the script node was asked to run. Compares real
 * filesystem paths so it holds for relative invocations, POSIX absolute paths
 * and bin symlinks (npm/pnpm link `lorien` → dist/cli.js), on every platform.
 */
export function isEntryPoint(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl))
  } catch {
    return false
  }
}

// Only execute when this module is the direct entry point (not when imported by tests)
if (isEntryPoint(import.meta.url, process.argv[1])) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

// Exported for tests
export { createProgram, VERSION }
