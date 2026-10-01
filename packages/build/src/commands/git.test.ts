import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  gitBranches,
  gitCommit,
  gitDiscard,
  gitFetch,
  gitLog,
  gitMerge,
  gitMergeAbort,
  gitPull,
  gitPush,
  gitResolve,
  gitSetIndex,
  gitShow,
  gitStage,
  gitStash,
  gitStashAction,
  gitStashes,
  gitStatus,
  gitSwitch,
  gitUndoCommit,
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
      conflicts: [],
      conflictsElsewhere: 0,
    })
  })

  it("parses merge conflicts, inside and outside the workspace", () => {
    const out = ["## main", "UU apps/api/a.ts", "DU apps/api/b.ts", "AA other/c.ts", ""].join("\0")
    const s = parseStatus(out, "apps/api/")
    expect(s.conflicts).toEqual([
      { path: "a.ts", ours: "modified", theirs: "modified" },
      { path: "b.ts", ours: "deleted", theirs: "modified" },
    ])
    expect(s.conflictsElsewhere).toBe(1)
    expect(s.staged).toEqual([])
    expect(s.changes).toEqual([])
  })
})

describe("branches, merges and remotes", () => {
  const wf = (status: string, extra = "") =>
    `{"lorien":1,"nodes":{"A":{"uses":"./a","values":{"status":"${status}"}}${extra}}}\n`
  const file = () => join(ws, "workflows", "a.workflow")

  it("lists, creates and switches branches", async () => {
    await gitSwitch(ws, { create: "feature/x" })
    let branches = await gitBranches(ws)
    expect(branches.find((b) => b.current)?.name).toBe("feature/x")
    expect(branches.map((b) => b.name).sort()).toEqual(["feature/x", "main"])
    await gitSwitch(ws, { branch: "main" })
    branches = await gitBranches(ws)
    expect(branches.find((b) => b.current)?.name).toBe("main")
    await expect(gitSwitch(ws, { create: "bad name" })).rejects.toThrow("isn't a valid branch name")
    await expect(gitSwitch(ws, { branch: "nope" })).rejects.toThrow("No branch named nope")
  })

  it("merges cleanly into the current branch", async () => {
    await gitSwitch(ws, { create: "feature" })
    writeFileSync(join(ws, "feature.ts"), "export {}\n")
    run("add", "-A")
    run("commit", "-q", "-m", "Feature")
    await gitSwitch(ws, { branch: "main" })
    await gitMerge(ws, "feature")
    const status = await gitStatus(ws)
    if (!status.repo) throw new Error("not a repo")
    expect(status.merging).toBeNull()
    expect(run("log", "-1", "--format=%s").trim()).toBe("Merge branch 'feature'")
  })

  it("stops on a conflict, shows each side, and commits once resolved", async () => {
    writeFileSync(file(), wf("new"))
    run("add", "-A")
    run("commit", "-q", "-m", "Base")
    await gitSwitch(ws, { create: "feature" })
    writeFileSync(file(), wf("theirs"))
    run("commit", "-qam", "Theirs")
    await gitSwitch(ws, { branch: "main" })
    writeFileSync(file(), wf("ours"))
    run("commit", "-qam", "Ours")

    await gitMerge(ws, "feature")
    let status = await gitStatus(ws)
    if (!status.repo) throw new Error("not a repo")
    expect(status.merging).toEqual({ branch: "feature", message: "Merge branch 'feature'" })
    expect(status.conflicts).toEqual([
      { path: "workflows/a.workflow", ours: "modified", theirs: "modified" },
    ])
    expect(await gitShow(ws, "workflows/a.workflow", "base")).toBe(wf("new"))
    expect(await gitShow(ws, "workflows/a.workflow", "ours")).toBe(wf("ours"))
    expect(await gitShow(ws, "workflows/a.workflow", "theirs")).toBe(wf("theirs"))
    await expect(gitCommit(ws, "Merge")).rejects.toThrow("Resolve the conflicts")
    await expect(gitSwitch(ws, { branch: "feature" })).rejects.toThrow("merge is in progress")

    await gitResolve(ws, { path: "workflows/a.workflow", content: wf("both") })
    status = await gitStatus(ws)
    if (!status.repo) throw new Error("not a repo")
    expect(status.conflicts).toEqual([])
    await gitCommit(ws, status.merging?.message ?? "")
    status = await gitStatus(ws)
    if (!status.repo) throw new Error("not a repo")
    expect(status.merging).toBeNull()
    expect(run("show", "HEAD:apps/api/workflows/a.workflow")).toBe(wf("both"))
  })

  it("resolves by taking one side, or aborts the merge", async () => {
    writeFileSync(file(), wf("new"))
    run("commit", "-qam", "Base")
    await gitSwitch(ws, { create: "feature" })
    writeFileSync(file(), wf("theirs"))
    run("commit", "-qam", "Theirs")
    await gitSwitch(ws, { branch: "main" })
    writeFileSync(file(), wf("ours"))
    run("commit", "-qam", "Ours")

    await gitMerge(ws, "feature")
    await gitResolve(ws, { path: "workflows/a.workflow", take: "theirs" })
    expect(readFileSync(file(), "utf-8")).toBe(wf("theirs"))
    await gitMergeAbort(ws)
    const status = await gitStatus(ws)
    if (!status.repo) throw new Error("not a repo")
    expect(status.merging).toBeNull()
    expect(readFileSync(file(), "utf-8")).toBe(wf("ours"))
    await expect(gitMergeAbort(ws)).rejects.toThrow("No merge is in progress")
  })

  it("pushes, fetches and pulls through a remote", async () => {
    const origin = mkdtempSync(join(tmpdir(), "lorien-origin-"))
    const other = mkdtempSync(join(tmpdir(), "lorien-other-"))
    try {
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin])
      run("remote", "add", "origin", origin)
      await expect(gitPull(ws)).rejects.toThrow("isn't tracking a remote branch")
      await gitPush(ws)
      let status = await gitStatus(ws)
      if (!status.repo) throw new Error("not a repo")
      expect(status.upstream).toBe("origin/main")

      // Someone else pushes a change.
      execFileSync("git", ["clone", "-q", origin, other])
      const o = (...args: string[]) => execFileSync("git", args, { cwd: other, stdio: "pipe" })
      o("config", "user.email", "o@example.com")
      o("config", "user.name", "Other")
      writeFileSync(join(other, "apps", "api", "theirs.ts"), "export {}\n")
      o("add", "-A")
      o("commit", "-q", "-m", "From elsewhere")
      o("push", "-q")
      o("push", "-q", "origin", "HEAD:refs/heads/shared")

      await gitFetch(ws)
      status = await gitStatus(ws)
      if (!status.repo) throw new Error("not a repo")
      expect(status.behind).toBe(1)
      expect((await gitBranches(ws)).some((b) => b.remote && b.name === "origin/shared")).toBe(true)
      await gitPull(ws)
      expect((await gitLog(ws, 1))[0]?.subject).toBe("From elsewhere")

      // A remote branch switches to a local branch tracking it.
      await gitSwitch(ws, { branch: "origin/shared" })
      const current = (await gitBranches(ws)).find((b) => b.current)
      expect(current).toMatchObject({ name: "shared", upstream: "origin/shared" })
    } finally {
      rmSync(origin, { recursive: true, force: true })
      rmSync(other, { recursive: true, force: true })
    }
  })
})

describe("everyday actions", () => {
  const a = () => join(ws, "workflows", "a.workflow")
  const changes = async () => {
    const s = await gitStatus(ws)
    if (!s.repo) throw new Error("not a repo")
    return s
  }

  it("discards changes to tracked files and deletes new ones", async () => {
    writeFileSync(a(), "edited\n")
    writeFileSync(join(ws, "new.ts"), "export {}\n")
    rmSync(join(ws, "old.ts"))
    await gitDiscard(ws, ["workflows/a.workflow", "new.ts", "old.ts"])
    expect((await changes()).changes).toEqual([])
    expect(readFileSync(a(), "utf-8")).toBe('{"lorien":1,"nodes":{}}\n')
    expect(readFileSync(join(ws, "old.ts"), "utf-8")).toBe("export {}\n")
  })

  it("discards back to what's staged, not the last commit", async () => {
    writeFileSync(a(), "staged\n")
    await gitStage(ws, ["workflows/a.workflow"])
    writeFileSync(a(), "on disk\n")
    await gitDiscard(ws, ["workflows/a.workflow"])
    expect(readFileSync(a(), "utf-8")).toBe("staged\n")
    expect((await changes()).staged).toEqual([{ path: "workflows/a.workflow", status: "M" }])
  })

  it("writes the staged side of a file without touching the disk", async () => {
    writeFileSync(a(), "line 1\nline 2\n")
    await gitSetIndex(ws, "workflows/a.workflow", "line 1\n")
    expect(await gitShow(ws, "workflows/a.workflow", "index")).toBe("line 1\n")
    expect(readFileSync(a(), "utf-8")).toBe("line 1\nline 2\n")
    const s = await changes()
    expect(s.staged).toEqual([{ path: "workflows/a.workflow", status: "M" }])
    expect(s.changes).toEqual([{ path: "workflows/a.workflow", status: "M" }])
    // A new file can be staged in part too.
    await gitSetIndex(ws, "part.ts", "export {}\n")
    expect(run("ls-files", "apps/api/part.ts").trim()).toBe("apps/api/part.ts")
    await expect(gitSetIndex(ws, "../x", "")).rejects.toThrow("outside the workspace")
  })

  it("commits everything when nothing is staged, amends, and undoes", async () => {
    writeFileSync(a(), "edited\n")
    writeFileSync(join(ws, "new.ts"), "export {}\n")
    await expect(gitCommit(ws, "No stage")).rejects.toThrow("Nothing is staged")
    await gitCommit(ws, "Everything", { all: true })
    expect(run("show", "--name-only", "--format=", "HEAD").trim().split("\n").sort()).toEqual([
      "apps/api/new.ts",
      "apps/api/workflows/a.workflow",
    ])
    expect((await changes()).head?.subject).toBe("Everything")

    // Amend with only a new message, then with a staged file and the old message.
    await gitCommit(ws, "Renamed", { amend: true })
    writeFileSync(join(ws, "more.ts"), "export {}\n")
    await gitStage(ws, ["more.ts"])
    await gitCommit(ws, "", { amend: true })
    expect(run("log", "--format=%s").trim().split("\n")).toEqual(["Renamed", "Initial"])
    expect(run("show", "--name-only", "--format=", "HEAD")).toContain("apps/api/more.ts")

    // Undo keeps the changes, staged.
    await gitUndoCommit(ws)
    const s = await changes()
    expect(s.head?.subject).toBe("Initial")
    expect(s.staged.map((f) => f.path).sort()).toEqual([
      "more.ts",
      "new.ts",
      "workflows/a.workflow",
    ])
    expect(readFileSync(a(), "utf-8")).toBe("edited\n")

    // Undoing the first commit leaves an unborn branch with everything staged.
    await gitUndoCommit(ws)
    expect((await changes()).head).toBeNull()
    await expect(gitUndoCommit(ws)).rejects.toThrow("no commit to undo")
  })

  it("stashes the workspace, lists, pops and drops stashes", async () => {
    writeFileSync(a(), "edited\n")
    writeFileSync(join(ws, "new.ts"), "export {}\n")
    writeFileSync(join(repo, "README.md"), "outside\n")
    await gitStash(ws, { message: "wip" })
    let s = await changes()
    expect(s.changes).toEqual([])
    // Only the workspace is stashed.
    expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("outside\n")
    const [stash] = await gitStashes(ws)
    expect(stash).toMatchObject({ index: 0 })
    expect(stash?.message).toContain("wip")

    await gitStashAction(ws, { index: 0, action: "pop" })
    s = await changes()
    expect(s.changes.map((c) => c.path).sort()).toEqual(["new.ts", "workflows/a.workflow"])
    expect(await gitStashes(ws)).toEqual([])

    await gitStash(ws, {})
    await gitStashAction(ws, { index: 0, action: "drop" })
    expect(await gitStashes(ws)).toEqual([])
    await expect(gitStash(ws, {})).rejects.toThrow("no changes to stash")
    await expect(gitStashAction(ws, { index: 3, action: "pop" })).rejects.toThrow(
      "no longer exists",
    )
  })
})
