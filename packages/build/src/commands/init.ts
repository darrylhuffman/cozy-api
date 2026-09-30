import { mkdir, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { Command } from "commander"
import { renderAgentsMd, renderClaudeSkill } from "create-lorien/templates"

export interface InitOptions {
  root: string
  force: boolean
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Add AGENTS.md and the Claude Code skill to the current project")
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

/**
 * Writes AGENTS.md and the Claude Code skill, the same guide `create-lorien`
 * scaffolds. An existing skill file is left alone unless `force` is set.
 */
export async function runInit(opts: RunInitOptions): Promise<RunInitResult> {
  const path = join(opts.root, "AGENTS.md")
  if (!opts.force && (await fileExists(path))) {
    console.error(`AGENTS.md already exists at ${path}. Use --force to overwrite.`)
    return { ok: false, error: "exists" }
  }
  await writeFile(path, renderAgentsMd(), "utf-8")
  console.log(`Wrote ${path}`)
  const skill = join(opts.root, ".claude", "skills", "lorien-api", "SKILL.md")
  if (opts.force || !(await fileExists(skill))) {
    await mkdir(dirname(skill), { recursive: true })
    await writeFile(skill, renderClaudeSkill(), "utf-8")
    console.log(`Wrote ${skill}`)
  }
  return { ok: true, path }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}
