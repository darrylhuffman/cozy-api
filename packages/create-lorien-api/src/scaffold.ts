import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { PackageManager } from "./detect-package-manager.js"
import {
  renderAgentsMd,
  renderBiomeJson,
  renderClaudeSkill,
  renderGitignore,
  renderHelloRequests,
  renderHelloWorkflow,
  renderLorienConfig,
  renderPackageJson,
  renderReadme,
  renderSayHelloCases,
  renderSayHelloNode,
  renderServerEntry,
  renderTsconfig,
  renderVitestConfig,
} from "./templates.js"

export interface ScaffoldOptions {
  target: string
  name: string
  pm: PackageManager
}

export async function scaffold(opts: ScaffoldOptions): Promise<void> {
  const { target, name, pm } = opts
  const ctx = { name }

  const files: Array<[string, string]> = [
    [".gitignore", renderGitignore()],
    ["package.json", renderPackageJson(ctx)],
    ["tsconfig.json", renderTsconfig()],
    ["biome.json", renderBiomeJson()],
    ["vitest.config.ts", renderVitestConfig()],
    ["lorien.config.ts", renderLorienConfig()],
    ["workflows/hello.workflow", renderHelloWorkflow()],
    ["workflows/hello.requests.json", renderHelloRequests()],
    ["nodes/say-hello.ts", renderSayHelloNode()],
    ["nodes/say-hello.cases.json", renderSayHelloCases()],
    ["src/server.ts", renderServerEntry()],
    ["AGENTS.md", renderAgentsMd()],
    [".claude/skills/lorien-api/SKILL.md", renderClaudeSkill()],
    ["README.md", renderReadme(ctx, pm)],
  ]

  for (const [relPath, contents] of files) {
    const abs = join(target, relPath)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, contents, "utf-8")
  }
}
