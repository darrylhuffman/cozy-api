import { resolve } from "node:path"
import type { Command } from "commander"
import { generateServicesTypes } from "../generate-services-types.js"
import { registerTsxFromWorkspace } from "./ide.js"

export function registerTypes(program: Command): void {
  program
    .command("types")
    .description("Generate .lorien/types/providers.d.ts so nodes see each provider's type")
    .option("--root <path>", "project root", process.cwd())
    .action(async (opts: { root: string }) => {
      const root = resolve(opts.root)
      await registerTsxFromWorkspace(root)
      const result = await generateServicesTypes(root)
      if (result.path) console.log(`✓ Generated ${result.path}`)
      // A provider left out of the types would surface later as a confusing
      // "Property 'x' does not exist on type 'Services'" from tsc.
      for (const e of result.errors) console.error(`✗ ${e.path}: ${e.message}`)
      if (result.errors.length > 0) process.exit(1)
    })
}
