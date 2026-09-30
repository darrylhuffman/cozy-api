import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { join, relative, resolve } from "node:path"
import {
  convertOpenApiSpec,
  loadOpenApiSpec,
  writeGeneratedFiles,
} from "@darrylondil/lorien-openapi"
import type { Command } from "commander"

export interface ImportOpenapiOptions {
  /** Project root: the client provider goes in <root>/providers. Defaults to the cwd. */
  root?: string
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
    .option("--root <path>", "project root", process.cwd())
    .option("--out <path>", "output directory for the nodes (default: nodes/<api-slug>)")
    .option("--force", "overwrite files even if user-modified")
    .option("--api-slug <slug>", "override the api slug")
    .option(
      "--base-url <url>",
      "default base URL for the client provider (else the spec's first server URL)",
    )
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

  const root = resolve(opts.root ?? process.cwd())
  const outRoot = opts.out ? resolve(opts.out) : join(root, "nodes", result.apiSlug)
  const providersDir = join(root, "providers")

  console.log(`Writing ${result.files.length} nodes to ${outRoot}…`)
  const nodes = await writeGeneratedFiles(result.files, outRoot, { force: opts.force ?? false })
  console.log(`Writing the client provider to ${providersDir}…`)
  const provider = await writeGeneratedFiles([result.provider], providersDir, {
    force: opts.force ?? false,
  })
  const writeResult = {
    written: [...nodes.written, ...provider.written.map((f) => `providers/${f}`)],
    preserved: [...nodes.preserved, ...provider.preserved.map((f) => `providers/${f}`)],
    errors: [...nodes.errors, ...provider.errors],
  }
  formatWithProjectBiome(root, [
    ...nodes.written.map((f) => join(outRoot, f)),
    ...provider.written.map((f) => join(providersDir, f)),
  ])

  if (result.warnings.length > 0) {
    console.log(``)
    console.log(`Warnings:`)
    for (const w of result.warnings) console.log(`  - ${w}`)
  }

  console.log(``)
  console.log(
    `✓ ${writeResult.written.length} written, ${writeResult.preserved.length} preserved, ${writeResult.errors.length} errors`,
  )
  console.log(
    `  Nodes read the API as \`${result.selector}\` (providers/${result.provider.relativePath}); add auth headers there.`,
  )

  return {
    apiSlug: result.apiSlug,
    written: writeResult.written,
    preserved: writeResult.preserved,
    warnings: result.warnings,
    errors: writeResult.errors,
  }
}

/** Formats the written files with the project's own Biome, when it has one, so `lint` stays clean. */
function formatWithProjectBiome(root: string, files: string[]): void {
  if (files.length === 0) return
  let bin: string
  try {
    bin = createRequire(join(root, "package.json")).resolve("@biomejs/biome/bin/biome")
  } catch {
    return
  }
  spawnSync(process.execPath, [bin, "format", "--write", ...files.map((f) => relative(root, f))], {
    cwd: root,
    stdio: "ignore",
  })
}
