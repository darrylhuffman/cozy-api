import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { PackageManager } from "./detect-package-manager.js"
import {
  renderAgentsMd,
  renderBiomeJson,
  renderCozyConfig,
  renderGitignore,
  renderHelloWorkflow,
  renderPackageJson,
  renderReadme,
  renderSayHelloNode,
  renderServerEntry,
  renderTsconfig,
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
    ["cozy.config.ts", renderCozyConfig()],
    ["workflows/hello.workflow", renderHelloWorkflow()],
    ["nodes/say-hello.ts", renderSayHelloNode()],
    ["src/server.ts", renderServerEntry()],
    ["AGENTS.md", renderAgentsMd(ctx)],
    ["README.md", renderReadme(ctx, pm)],
  ]

  for (const [relPath, contents] of files) {
    const abs = join(target, relPath)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, contents, "utf-8")
  }
}
