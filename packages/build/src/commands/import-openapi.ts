import { join, resolve } from "node:path"
import { convertOpenApiSpec, loadOpenApiSpec, writeGeneratedFiles } from "@darrylondil/lorien-openapi"
import type { Command } from "commander"

export interface ImportOpenapiOptions {
  out?: string
  force?: boolean
  apiSlug?: string
  baseUrl?: string
}

export function registerImportOpenapi(program: Command): void {
  program
    .command("import-openapi")
    .description("Generate client nodes from an OpenAPI 3.x JSON spec")
    .argument("<spec>", "path to OpenAPI JSON spec")
    .option("--out <path>", "output directory (default: nodes/<api-slug>)")
    .option("--force", "overwrite files even if user-modified")
    .option("--api-slug <slug>", "override the api slug")
    .option("--base-url <url>", "default base URL for _client.ts")
    .action(async (specPath: string, opts: ImportOpenapiOptions) => {
      const result = await runImportOpenapi(specPath, opts)
      if (result.errors.length > 0) process.exit(1)
    })
}

export interface RunImportResult {
  apiSlug: string
  written: string[]
  preserved: string[]
  warnings: string[]
  errors: Array<{ path: string; message: string }>
}

export async function runImportOpenapi(
  specPath: string,
  opts: ImportOpenapiOptions,
): Promise<RunImportResult> {
  const resolved = resolve(specPath)
  console.log(`Loading ${resolved}…`)
  const spec = await loadOpenApiSpec(resolved)

  const convertOpts: { apiSlug?: string; defaultBaseUrl?: string } = {}
  if (opts.apiSlug !== undefined) convertOpts.apiSlug = opts.apiSlug
  if (opts.baseUrl !== undefined) convertOpts.defaultBaseUrl = opts.baseUrl
  const result = convertOpenApiSpec(spec, convertOpts)

  const outRoot = opts.out ? resolve(opts.out) : join(process.cwd(), "nodes", result.apiSlug)

  console.log(`Writing ${result.files.length} files to ${outRoot}…`)
  const writeResult = await writeGeneratedFiles(result.files, outRoot, {
    force: opts.force ?? false,
  })

  if (result.warnings.length > 0) {
    console.log(``)
    console.log(`Warnings:`)
    for (const w of result.warnings) console.log(`  - ${w}`)
  }

  console.log(``)
  console.log(
    `✓ ${writeResult.written.length} written, ${writeResult.preserved.length} preserved, ${writeResult.errors.length} errors`,
  )

  return {
    apiSlug: result.apiSlug,
    written: writeResult.written,
    preserved: writeResult.preserved,
    warnings: result.warnings,
    errors: writeResult.errors,
  }
}
