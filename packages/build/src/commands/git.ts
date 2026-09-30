import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
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

export type ConflictSide = "modified" | "added" | "deleted"

/** A file a merge couldn't combine on its own: what each side did to it. */
export interface GitConflict {
  path: string
  ours: ConflictSide
  theirs: ConflictSide
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
  /** Files in this workspace a merge left for a person to resolve. */
  conflicts: GitConflict[]
  /** Conflicted files outside this workspace; they must be resolved elsewhere. */
  conflictsElsewhere: number
  /** Set while a merge (or a pull that merged) waits to be committed. */
  merging: { branch: string | null; message: string } | null
}

export interface GitBranch {
  /** "main", or "origin/main" for a remote branch. */
  name: string
  remote: boolean
  current: boolean
  /** The remote branch a local branch tracks. */
  upstream: string | null
  ahead: number
  behind: number
  /** Unix seconds of the last commit. */
  time: number
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
      {
        cwd: root,
        maxBuffer: 32 * 1024 * 1024,
        // Never wait on a prompt or an editor: the IDE has no terminal to show them in.
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_EDITOR: "true",
          GIT_MERGE_AUTOEDIT: "no",
        },
      },
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
const UNMERGED: Record<string, [ConflictSide, ConflictSide]> = {
  DD: ["deleted", "deleted"],
  AU: ["added", "modified"],
  UD: ["modified", "deleted"],
  UA: ["modified", "added"],
  DU: ["deleted", "modified"],
  AA: ["added", "added"],
  UU: ["modified", "modified"],
}

export function parseStatus(out: string, prefix: string): Omit<GitStatus, "repo" | "merging"> {
  const entries = out.split("\0")
  const result: Omit<GitStatus, "repo" | "merging"> = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    changes: [],
    stagedElsewhere: 0,
    conflicts: [],
    conflictsElsewhere: 0,
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
    const unmerged = UNMERGED[x + y]
    if (unmerged) {
      if (path === null) result.conflictsElsewhere++
      else result.conflicts.push({ path, ours: unmerged[0], theirs: unmerged[1] })
      continue
    }
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
  return { repo: true, ...parseStatus(out, prefix), merging: await mergeState(root) }
}

/** The merge in progress, if any: which branch, and git's prepared message. */
async function mergeState(root: string): Promise<GitStatus["merging"]> {
  try {
    await git(root, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])
  } catch {
    return null
  }
  let message = ""
  try {
    const file = (
      await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "MERGE_MSG"])
    ).trim()
    message = (await readFile(file, "utf-8"))
      .split("\n")
      .filter((l) => !l.startsWith("#"))
      .join("\n")
      .trim()
  } catch {
    // No prepared message; the panel asks for one.
  }
  const branch = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(message)?.[1] ?? null
  return { branch, message }
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

/**
 * Where to read a file from. During a merge, "base" is the common ancestor,
 * "ours" the current branch and "theirs" the branch being merged in.
 */
export type GitRevision = "HEAD" | "index" | "worktree" | "base" | "ours" | "theirs"

const REVISIONS: GitRevision[] = ["HEAD", "index", "worktree", "base", "ours", "theirs"]
const STAGE: Partial<Record<GitRevision, string>> = { index: "", base: "1", ours: "2", theirs: "3" }

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
  const file = `${prefix}${path.split(sep).join("/")}`
  const spec = rev === "HEAD" ? `HEAD:${file}` : `:${STAGE[rev] ? `${STAGE[rev]}:` : ""}${file}`
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
  if (status.conflicts.length > 0 || status.conflictsElsewhere > 0) {
    throw new GitError(
      status.conflicts.length > 0
        ? "Resolve the conflicts before committing the merge"
        : `${status.conflictsElsewhere} conflicted file${status.conflictsElsewhere === 1 ? " is" : "s are"} outside this workspace. Resolve ${status.conflictsElsewhere === 1 ? "it" : "them"} in the repository first.`,
      409,
    )
  }
  // A merge commit takes the whole merge, including files outside the
  // workspace; git can't commit part of one.
  if (!status.merging && status.staged.length === 0) {
    throw new GitError("Nothing is staged", 409)
  }
  if (!status.merging && status.stagedElsewhere > 0) {
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

/** Local and remote branches, most recently committed first. */
export async function gitBranches(root: string): Promise<GitBranch[]> {
  let out: string
  try {
    out = await git(root, [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname)%1f%(refname:short)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:unix)%1f%(HEAD)",
      "refs/heads",
      "refs/remotes",
    ])
  } catch {
    return []
  }
  const branches: GitBranch[] = []
  for (const line of out.split("\n")) {
    if (!line) continue
    const [ref = "", name = "", upstream = "", track = "", time = "0", head = ""] =
      line.split("\x1f")
    // origin/HEAD is an alias for the remote's default branch.
    if (ref.startsWith("refs/remotes/") && ref.endsWith("/HEAD")) continue
    branches.push({
      name,
      remote: ref.startsWith("refs/remotes/"),
      current: head === "*",
      upstream: upstream || null,
      ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
      behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
      time: Number(time),
    })
  }
  return branches
}

async function checkBranchName(root: string, name: unknown): Promise<string> {
  if (typeof name !== "string" || name.trim() === "") throw new GitError("Name the branch", 400)
  try {
    await git(root, ["check-ref-format", "--branch", name.trim()])
  } catch {
    throw new GitError(`"${name}" isn't a valid branch name`, 400)
  }
  return name.trim()
}

async function refuseWhileMerging(root: string, what: string): Promise<void> {
  if (await mergeState(root)) {
    throw new GitError(`A merge is in progress. Commit or abort it before you ${what}.`, 409)
  }
}

/**
 * Switches to a branch. A remote branch ("origin/feature") gets a local
 * branch tracking it. With `create`, makes a new branch from `from` (or the
 * current commit) and switches to it. Git refuses when uncommitted changes
 * would be overwritten; its message is passed on.
 */
export async function gitSwitch(
  root: string,
  opts: { branch?: unknown; create?: unknown; from?: unknown },
): Promise<void> {
  await refuseWhileMerging(root, "switch branches")
  if (opts.create !== undefined) {
    const name = await checkBranchName(root, opts.create)
    const from = typeof opts.from === "string" && opts.from ? [opts.from] : []
    await git(root, ["switch", "-c", name, ...from])
    return
  }
  if (typeof opts.branch !== "string" || !opts.branch) throw new GitError("Pick a branch", 400)
  const branches = await gitBranches(root)
  const target = branches.find((b) => b.name === opts.branch)
  if (!target) throw new GitError(`No branch named ${opts.branch}`, 404)
  if (target.remote) {
    const localName = target.name.slice(target.name.indexOf("/") + 1)
    if (branches.some((b) => !b.remote && b.name === localName)) {
      await git(root, ["switch", localName])
    } else {
      await git(root, ["switch", "--track", target.name])
    }
    return
  }
  await git(root, ["switch", target.name])
}

/** Fetches every remote, dropping remote branches that were deleted. */
export async function gitFetch(root: string): Promise<void> {
  await git(root, ["fetch", "--all", "--prune"])
}

/**
 * Runs a command that merges; a merge that stops on conflicts is not an
 * error here, since the panel shows the conflicts to resolve.
 */
async function merging(root: string, args: string[]): Promise<void> {
  try {
    await git(root, args)
  } catch (e) {
    if (await mergeState(root)) return
    throw e
  }
}

/** Pulls the current branch's upstream, merging (never rebasing). */
export async function gitPull(root: string): Promise<void> {
  await refuseWhileMerging(root, "pull")
  const status = await gitStatus(root)
  if (status.repo && !status.upstream) {
    throw new GitError("This branch isn't tracking a remote branch yet. Push it first.", 409)
  }
  await merging(root, ["pull", "--no-rebase", "--no-edit"])
}

/** Pushes the current branch, setting its upstream on origin the first time. */
export async function gitPush(root: string): Promise<void> {
  await refuseWhileMerging(root, "push")
  const status = await gitStatus(root)
  if (!status.repo || !status.branch) throw new GitError("Switch to a branch before pushing", 409)
  if (status.upstream) {
    await git(root, ["push"])
    return
  }
  const remotes = (await git(root, ["remote"])).split("\n").filter(Boolean)
  const remote = remotes.includes("origin") ? "origin" : remotes[0]
  if (!remote) throw new GitError("This repository has no remote to push to", 409)
  await git(root, ["push", "-u", remote, status.branch])
}

/** Merges a branch into the current one. Conflicts leave the merge open to resolve. */
export async function gitMerge(root: string, branch: unknown): Promise<void> {
  await refuseWhileMerging(root, "start another merge")
  if (typeof branch !== "string" || !branch) throw new GitError("Pick a branch to merge", 400)
  if (!(await gitBranches(root)).some((b) => b.name === branch)) {
    throw new GitError(`No branch named ${branch}`, 404)
  }
  await merging(root, ["merge", "--no-edit", "--no-ff", branch])
}

export async function gitMergeAbort(root: string): Promise<void> {
  if (!(await mergeState(root))) throw new GitError("No merge is in progress", 409)
  await git(root, ["merge", "--abort"])
}

/**
 * Marks a conflicted file resolved: with `content`, as written; with `take`,
 * as one side had it (a side that deleted the file deletes it).
 */
export async function gitResolve(
  root: string,
  body: { path?: unknown; content?: unknown; take?: unknown },
): Promise<void> {
  if (typeof body.path !== "string") throw new GitError("Expected { path }", 400)
  const abs = inside(root, body.path)
  const status = await gitStatus(root)
  const conflict = status.repo ? status.conflicts.find((c) => c.path === body.path) : undefined
  if (!conflict) throw new GitError(`${body.path} has no conflict to resolve`, 409)
  if (typeof body.content === "string") {
    await writeFile(abs, body.content)
    await git(root, ["add", "--", body.path])
    return
  }
  if (body.take !== "ours" && body.take !== "theirs") {
    throw new GitError('Expected { content } or { take: "ours" | "theirs" }', 400)
  }
  if (conflict[body.take] === "deleted") {
    await git(root, ["rm", "-q", "--", body.path])
    return
  }
  await git(root, ["checkout", `--${body.take}`, "--", body.path])
  await git(root, ["add", "--", body.path])
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
      if (!path || !rev || !REVISIONS.includes(rev)) {
        throw new GitError(`Expected ?path=&rev=${REVISIONS.join("|")}`, 400)
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
  const post = (path: string, fn: (body: Record<string, unknown>) => Promise<void>) =>
    app.post(path, (c) =>
      handle(c, async () => {
        const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
        await fn(body)
        return gitStatus(root)
      }),
    )
  app.get("/api/git/branches", (c) =>
    handle(c, async () => ({ branches: await gitBranches(root) })),
  )
  post("/api/git/switch", (b) => gitSwitch(root, b))
  post("/api/git/fetch", () => gitFetch(root))
  post("/api/git/pull", () => gitPull(root))
  post("/api/git/push", () => gitPush(root))
  post("/api/git/merge", (b) => gitMerge(root, b.branch))
  post("/api/git/merge-abort", () => gitMergeAbort(root))
  post("/api/git/resolve", (b) => gitResolve(root, b))
  app.post("/api/git/commit", (c) =>
    handle(c, async () => {
      const body = (await c.req.json().catch(() => ({}))) as { message?: unknown }
      if (typeof body.message !== "string") throw new GitError("Expected { message }", 400)
      return { commit: await gitCommit(root, body.message) }
    }),
  )
}
