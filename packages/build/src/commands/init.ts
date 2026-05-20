import { stat, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import type { Command } from "commander"

export interface InitOptions {
  root: string
  force: boolean
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Add AGENTS.md to the current project")
    .option("--root <path>", "project root", process.cwd())
    .option("--force", "overwrite if AGENTS.md exists")
    .action(async (opts: InitOptions) => {
      const root = resolve(opts.root)
      const force = Boolean(opts.force)
      const result = await runInit({ root, force })
      if (!result.ok) {
        process.exit(1)
      }
    })
}

export interface RunInitOptions {
  root: string
  force: boolean
}

export interface RunInitResult {
  ok: boolean
  path?: string
  error?: string
}

export async function runInit(opts: RunInitOptions): Promise<RunInitResult> {
  const path = join(opts.root, "AGENTS.md")
  if (!opts.force && (await fileExists(path))) {
    console.error(`AGENTS.md already exists at ${path}. Use --force to overwrite.`)
    return { ok: false, error: "exists" }
  }
  const name = basename(opts.root)
  await writeFile(path, renderAgentsMd(name), "utf-8")
  console.log(`Wrote ${path}`)
  return { ok: true, path }
}

function renderAgentsMd(name: string): string {
  return `# AI agent guide for ${name}

This project uses **cozy-api**: a file-based API framework where \`.workflow\`
files define HTTP endpoints as dependency graphs of typed nodes.

## Layout

- \`workflows/**/*.workflow\` — HTTP routes as JSON dependency graphs
- \`nodes/**/*.ts\` — typed compute units (via \`defineNode\` from \`@cozy/runtime\`)
- \`cozy.config.ts\` — service registry (db, logger, etc.)

## Adding a new endpoint

1. Create a node in \`nodes/\` (e.g., \`nodes/calculate.ts\`):

   \`\`\`ts
   import { defineNode } from "@cozy/runtime"
   import { z } from "zod"

   export default defineNode({
     name: "Calculate",
     inputs: z.object({ x: z.number() }),
     outputs: z.object({ result: z.number() }),
     async run({ x }) {
       return { result: x * 2 }
     },
   })
   \`\`\`

2. Create a workflow in \`workflows/\` (e.g., \`workflows/calc.workflow\`):

   \`\`\`json
   {
     "cozy": 1,
     "nodes": {
       "req": { "uses": "@core/http-request", "config": { "path": "/calc", "method": "POST" } },
       "calc": { "uses": "./nodes/calculate", "in": { "x": "req.body.x" } },
       "res": { "uses": "@core/response", "in": { "body": "calc.result" } }
     }
   }
   \`\`\`

3. Restart the dev server. \`POST /calc {"x": 5}\` returns \`10\`.

## References

- Documentation: https://cozy-api.dev (placeholder)
- @cozy/runtime API: \`testWorkflow\`, \`traceWorkflow\`, \`defineNode\`, \`defineConfig\`
`
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}
