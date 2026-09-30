import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const example = join(here, "..", "..", "..", "examples", "basic-api")
const cli = join(here, "..", "..", "build", "dist", "cli.js")

/**
 * A throwaway copy of the example app inside its own git repository, nested
 * at apps/api like a monorepo, with a bare "origin". Branch tests switch,
 * merge and pull here instead of in the real checkout.
 */
export interface Sandbox {
  dir: string
  workspace: string
  origin: string
  git(...args: string[]): string
  /** Commits `edit` of list.workflow as someone else, straight to origin's `branch`. */
  pushFromElsewhere(branch: string, edit: (wf: Json) => void, message: string): void
  url: string
  stop(): Promise<void>
}

const LIST = "workflows/pets/list.workflow"

// biome-ignore lint/suspicious/noExplicitAny: tests edit workflow JSON freely
type Json = Record<string, any>

export function editWorkflow(ws: string, edit: (wf: Json) => void): void {
  const file = join(ws, LIST)
  const wf = JSON.parse(readFileSync(file, "utf-8"))
  edit(wf)
  writeFileSync(file, `${JSON.stringify(wf, null, 2)}\n`)
}

export async function startSandbox(port: number): Promise<Sandbox> {
  const dir = mkdtempSync(join(tmpdir(), "lorien-e2e-git-"))
  const workspace = join(dir, "apps", "api")
  const origin = join(dir, "..", `${dir.split("/").pop()}-origin.git`)
  mkdirSync(workspace, { recursive: true })
  cpSync(example, workspace, {
    recursive: true,
    filter: (src) => !/[/\\](node_modules|data|dist|\.lorien)$/.test(src),
  })
  symlinkSync(join(example, "node_modules"), join(workspace, "node_modules"), "dir")
  writeFileSync(join(dir, ".gitignore"), "node_modules\ndata\ndist\n.lorien\n")
  writeFileSync(join(dir, "README.md"), "sandbox\n")

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString()
  git("init", "-q", "-b", "main")
  git("config", "user.email", "e2e@example.com")
  git("config", "user.name", "E2E")
  git("config", "commit.gpgsign", "false")
  git("add", "-A")
  git("commit", "-q", "-m", "Initial")
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin])
  git("remote", "add", "origin", origin)
  git("push", "-q", "-u", "origin", "main")

  const pushFromElsewhere: Sandbox["pushFromElsewhere"] = (branch, edit, message) => {
    const other = mkdtempSync(join(tmpdir(), "lorien-e2e-other-"))
    try {
      const o = (...args: string[]) => execFileSync("git", args, { cwd: other, stdio: "pipe" })
      execFileSync("git", ["clone", "-q", origin, other])
      o("config", "user.email", "other@example.com")
      o("config", "user.name", "Other")
      o("checkout", "-q", "-B", branch, `origin/main`)
      editWorkflow(join(other, "apps", "api"), edit)
      o("commit", "-qam", message)
      o("push", "-q", "origin", `HEAD:refs/heads/${branch}`)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  }

  const server: ChildProcess = spawn(
    "node",
    [cli, "ide", "--root", workspace, "--no-open", "--port", String(port)],
    { env: { ...process.env, PETSTORE_DB: ":memory:" }, stdio: "ignore" },
  )
  const url = `http://localhost:${port}`
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) break
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  return {
    dir,
    workspace,
    origin,
    git,
    pushFromElsewhere,
    url,
    async stop() {
      server.kill()
      rmSync(dir, { recursive: true, force: true })
      rmSync(origin, { recursive: true, force: true })
    },
  }
}
