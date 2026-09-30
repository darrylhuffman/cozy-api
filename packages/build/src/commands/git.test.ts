import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  gitCommit,
  gitLog,
  gitShow,
  gitStage,
  gitStatus,
  gitUnstage,
  mountGitRoutes,
  parseStatus,
} from "./git.js"

let repo: string
let ws: string
const run = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString()

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "lorien-git-"))
  run("init", "-q", "-b", "main")
  run("config", "user.email", "t@example.com")
  run("config", "user.name", "Tester")
  run("config", "commit.gpgsign", "false")
  // The workspace is a folder inside the repository, like examples/basic-api.
  ws = join(repo, "apps", "api")
  mkdirSync(join(ws, "workflows"), { recursive: true })
  writeFileSync(join(ws, "workflows", "a.workflow"), '{"lorien":1,"nodes":{}}\n')
  writeFileSync(join(ws, "old.ts"), "export {}\n")
  writeFileSync(join(repo, "README.md"), "hi\n")
  run("add", "-A")
  run("commit", "-q", "-m", "Initial")
})

afterEach(() => rmSync(repo, { recursive: true, force: true }))

describe("git for the IDE", () => {
  it("lists only the workspace's changes, with paths relative to it", async () => {
    writeFileSync(
      join(ws, "workflows", "a.workflow"),
      '{"lorien":1,"nodes":{"x":{"uses":"./x"}}}\n',
    )
    writeFileSync(join(ws, "new.ts"), "export const x = 1\n")
    rmSync(join(ws, "old.ts"))
    writeFileSync(join(repo, "README.md"), "changed\n")
    const status = await gitStatus(ws)
    if (!status.repo) throw new Error("not a repo")
    expect(status.branch).toBe("main")
    expect(status.staged).toEqual([])
    expect(status.changes).toEqual(
      expect.arrayContaining([
        { path: "workflows/a.workflow", status: "M" },
        { path: "new.ts", status: "U" },
        { path: "old.ts", status: "D" },
      ]),
    )
    expect(status.changes).toHaveLength(3)
  })

  it("stages, shows each revision, unstages and commits", async () => {
    writeFileSync(join(ws, "workflows", "a.workflow"), "staged\n")
    await gitStage(ws, ["workflows/a.workflow"])
    writeFileSync(join(ws, "workflows", "a.workflow"), "on disk\n")
    const status = await gitStatus(ws)
    if (!status.repo) throw new Error("not a repo")
    expect(status.staged).toEqual([{ path: "workflows/a.workflow", status: "M" }])
    expect(status.changes).toEqual([{ path: "workflows/a.workflow", status: "M" }])
    expect(await gitShow(ws, "workflows/a.workflow", "HEAD")).toBe('{"lorien":1,"nodes":{}}\n')
    expect(await gitShow(ws, "workflows/a.workflow", "index")).toBe("staged\n")
    expect(await gitShow(ws, "workflows/a.workflow", "worktree")).toBe("on disk\n")
    expect(await gitShow(ws, "nope.ts", "HEAD")).toBeNull()

    const commit = await gitCommit(ws, "Stage a workflow")
    expect(commit.subject).toBe("Stage a workflow")
    expect((await gitLog(ws)).map((c) => c.subject)).toEqual(["Stage a workflow", "Initial"])

    await gitStage(ws, ["workflows/a.workflow"])
    await gitUnstage(ws, ["workflows/a.workflow"])
    const after = await gitStatus(ws)
    expect(after.repo && after.staged).toEqual([])
  })

  it("won't commit files staged outside the workspace", async () => {
    writeFileSync(join(repo, "README.md"), "changed\n")
    run("add", "README.md")
    writeFileSync(join(ws, "new.ts"), "export {}\n")
    await gitStage(ws, ["new.ts"])
    await expect(gitCommit(ws, "Mine")).rejects.toThrow(/1 file is staged outside this workspace/)
  })

  it("serves it over HTTP and refuses paths outside the workspace", async () => {
    const app = new Hono()
    mountGitRoutes(app, ws)
    writeFileSync(join(ws, "new.ts"), "export {}\n")
    const staged = await app.request("/api/git/stage", {
      method: "POST",
      body: JSON.stringify({ paths: ["new.ts"] }),
    })
    expect(((await staged.json()) as { staged: unknown[] }).staged).toEqual([
      { path: "new.ts", status: "A" },
    ])
    const outside = await app.request("/api/git/show?path=../../README.md&rev=HEAD")
    expect(outside.status).toBe(400)
    const empty = await app.request("/api/git/commit", {
      method: "POST",
      body: JSON.stringify({ message: " " }),
    })
    expect(empty.status).toBe(400)
  })

  it("reports a folder outside any repository", async () => {
    const lone = mkdtempSync(join(tmpdir(), "lorien-nogit-"))
    try {
      expect(await gitStatus(lone)).toEqual({ repo: false })
    } finally {
      rmSync(lone, { recursive: true, force: true })
    }
  })

  it("parses branch tracking and renames", () => {
    const out = [
      "## feat/x...origin/feat/x [ahead 2, behind 1]",
      "R  apps/api/b.ts",
      "apps/api/a.ts",
      "M  other/c.ts",
      "",
    ].join("\0")
    expect(parseStatus(out, "apps/api/")).toEqual({
      branch: "feat/x",
      upstream: "origin/feat/x",
      ahead: 2,
      behind: 1,
      staged: [{ path: "b.ts", status: "R", from: "a.ts" }],
      changes: [],
      stagedElsewhere: 1,
    })
  })
})
