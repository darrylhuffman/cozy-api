import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve, sep } from "node:path"
import type { Hono } from "hono"

/**
 * Git for the IDE's Source Control panel. Everything is scoped to the
 * workspace: when the workspace is a folder inside a larger repository (a
 * monorepo), only its files are listed, staged and committed, and paths are
 * relative to the workspace root like every other IDE path.
 */

export interface GitFileChange {
  /** Path relative to the workspace root. */
  path: string
  /** M modified, A added, D deleted, R renamed, U untracked (new, not yet staged). */
  status: "M" | "A" | "D" | "R" | "U"
  /** For renames, where it came from. */
  from?: string
}

export interface GitStatus {
  repo: true
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: GitFileChange[]
  changes: GitFileChange[]
  /** Files staged outside this workspace, which a commit from here would include. */
  stagedElsewhere: number
}

export interface GitCommit {
  hash: string
  subject: string
  /** Unix seconds. */
  time: number
  author: string
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 500 = 500,
  ) {
    super(message)
  }
}

function git(root: string, args: string[], opts: { input?: string } = {}): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      "git",
      args,
      { cwd: root, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || err.message).trim().split("\n").slice(-3).join("\n")
          reject(new GitError(detail || `git ${args[0]} failed`))
          return
        }
        resolvePromise(stdout)
      },
    )
    if (opts.input !== undefined) child.stdin?.end(opts.input)
  })
}

/** The workspace's path inside its repository ("" at the top, "examples/app/" below it), or null outside a repo. */
export async function gitPrefix(root: string): Promise<string | null> {
  try {
    const out = await git(root, ["rev-parse", "--show-prefix"])
    return out.trim()
  } catch {
    return null
  }
}

function toStatus(code: string): GitFileChange["status"] {
  if (code === "?") return "U"
  if (code === "A" || code === "D" || code === "R") return code
  if (code === "C") return "A"
  return "M"
}

/** Parses `git status --porcelain=v1 -z --branch`. Paths come back relative to the repo root. */
export function parseStatus(out: string, prefix: string): Omit<GitStatus, "repo"> {
  const entries = out.split("\0")
  const result: Omit<GitStatus, "repo"> = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    changes: [],
    stagedElsewhere: 0,
  }
  const local = (p: string) => (p.startsWith(prefix) ? p.slice(prefix.length) : null)
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry) continue
    if (entry.startsWith("## ")) {
      const head = entry.slice(3)
      const noCommits = /^No commits yet on (.+)$/.exec(head)
      if (noCommits) {
        result.branch = noCommits[1] ?? null
        continue
      }
      const m = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(head)
      if (m) {
        result.branch = m[1] === "HEAD (no branch)" ? null : (m[1] ?? null)
        result.upstream = m[2] ?? null
        result.ahead = Number(/ahead (\d+)/.exec(m[3] ?? "")?.[1] ?? 0)
        result.behind = Number(/behind (\d+)/.exec(m[3] ?? "")?.[1] ?? 0)
      }
      continue
    }
    const x = entry[0] ?? " "
    const y = entry[1] ?? " "
    const repoPath = entry.slice(3)
    // Renames and copies are followed by the original path.
    const from = x === "R" || x === "C" ? entries[++i] : undefined
    const path = local(repoPath)
    if (path === null) {
      if (x !== " " && x !== "?") result.stagedElsewhere++
      continue
    }
    const fromLocal = from !== undefined ? (local(from) ?? from) : undefined
    if (x === "?") {
      result.changes.push({ path, status: "U" })
      continue
    }
    if (x !== " ") {
      result.staged.push({ path, status: toStatus(x), ...(fromLocal ? { from: fromLocal } : {}) })
    }
    if (y !== " ") result.changes.push({ path, status: toStatus(y) })
  }
  return result
}

export async function gitStatus(root: string): Promise<GitStatus | { repo: false }> {
  const prefix = await gitPrefix(root)
  if (prefix === null) return { repo: false }
  // Whole repo, so staged files elsewhere can be counted; filtered below.
  const out = await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--branch",
    "--untracked-files=all",
    ":/",
  ])
  return { repo: true, ...parseStatus(out, prefix) }
}

export async function gitLog(root: string, limit = 30): Promise<GitCommit[]> {
  let out: string
  try {
    out = await git(root, ["log", `-n${limit}`, "--format=%h%x1f%s%x1f%ct%x1f%an%x1e", "--", "."])
  } catch {
    // A repository with no commits yet has no history.
    return []
  }
  return out
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash = "", subject = "", time = "0", author = ""] = r.split("\x1f")
      return { hash, subject, time: Number(time), author }
    })
}

/** Resolves a workspace path, refusing anything outside the workspace. */
function inside(root: string, path: string): string {
  const abs = resolve(root, path)
  if (!abs.startsWith(root + sep)) throw new GitError("Path is outside the workspace", 400)
  return abs
}

export type GitRevision = "HEAD" | "index" | "worktree"

/** A file's content at HEAD, in the index, or on disk; null when it doesn't exist there. */
export async function gitShow(
  root: string,
  path: string,
  rev: GitRevision,
): Promise<string | null> {
  const abs = inside(root, path)
  if (rev === "worktree") {
    try {
      return await readFile(abs, "utf-8")
    } catch {
      return null
    }
  }
  const prefix = (await gitPrefix(root)) ?? ""
  const spec = `${rev === "HEAD" ? "HEAD" : ""}:${prefix}${path.split(sep).join("/")}`
  try {
    return await git(root, ["show", spec])
  } catch {
    return null
  }
}

function checkPaths(root: string, paths: unknown): string[] {
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((p) => typeof p !== "string")) {
    throw new GitError("Expected { paths: string[] }", 400)
  }
  for (const p of paths as string[]) inside(root, p)
  return paths as string[]
}

export async function gitStage(root: string, paths: string[]): Promise<void> {
  // -A so deletions are staged too.
  await git(root, ["add", "-A", "--", ...paths])
}

export async function gitUnstage(root: string, paths: string[]): Promise<void> {
  try {
    await git(root, ["restore", "--staged", "--", ...paths])
  } catch {
    // Before the first commit there is no HEAD to restore from.
    await git(root, ["rm", "--cached", "-r", "-q", "--", ...paths])
  }
}

export async function gitCommit(root: string, message: string): Promise<GitCommit> {
  if (message.trim() === "") throw new GitError("Write a commit message first", 400)
  const status = await gitStatus(root)
  if (!status.repo) throw new GitError("This workspace isn't in a git repository", 409)
  if (status.staged.length === 0) throw new GitError("Nothing is staged", 409)
  if (status.stagedElsewhere > 0) {
    throw new GitError(
      `${status.stagedElsewhere} file${status.stagedElsewhere === 1 ? " is" : "s are"} staged outside this workspace. Commit or unstage ${status.stagedElsewhere === 1 ? "it" : "them"} first so this commit only holds the workspace.`,
      409,
    )
  }
  await git(root, ["commit", "-F", "-"], { input: message })
  const [latest] = await gitLog(root, 1)
  if (!latest) throw new GitError("Committed, but couldn't read the new commit")
  return latest
}

/** GET/POST /api/git/* for the Source Control panel. */
export function mountGitRoutes(app: Hono, root: string): void {
  const handle = async (
    c: { json: (b: unknown, s?: number) => Response },
    fn: () => Promise<unknown>,
  ) => {
    try {
      return c.json(await fn())
    } catch (e) {
      const status = e instanceof GitError ? e.status : 500
      return c.json({ error: (e as Error).message }, status)
    }
  }

  app.get("/api/git/status", (c) => handle(c, () => gitStatus(root)))
  app.get("/api/git/log", (c) =>
    handle(c, async () => ({ commits: await gitLog(root, Number(c.req.query("limit") ?? 30)) })),
  )
  app.get("/api/git/show", (c) =>
    handle(c, async () => {
      const path = c.req.query("path")
      const rev = c.req.query("rev") as GitRevision | undefined
      if (!path || (rev !== "HEAD" && rev !== "index" && rev !== "worktree")) {
        throw new GitError("Expected ?path=&rev=HEAD|index|worktree", 400)
      }
      return { path, rev, content: await gitShow(root, path, rev) }
    }),
  )
  app.post("/api/git/stage", (c) =>
    handle(c, async () => {
      const body = (await c.req.json().catch(() => ({}))) as { paths?: unknown }
      await gitStage(root, checkPaths(root, body.paths))
      return gitStatus(root)
    }),
  )
  app.post("/api/git/unstage", (c) =>
    handle(c, async () => {
      const body = (await c.req.json().catch(() => ({}))) as { paths?: unknown }
      await gitUnstage(root, checkPaths(root, body.paths))
      return gitStatus(root)
    }),
  )
  app.post("/api/git/commit", (c) =>
    handle(c, async () => {
      const body = (await c.req.json().catch(() => ({}))) as { message?: unknown }
      if (typeof body.message !== "string") throw new GitError("Expected { message }", 400)
      return { commit: await gitCommit(root, body.message) }
    }),
  )
}
