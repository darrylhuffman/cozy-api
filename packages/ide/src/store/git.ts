import { useEffect } from "react"
import { create } from "zustand"
import {
  abortMerge,
  commitStaged,
  discardChanges,
  fetchGitBranches,
  fetchGitLog,
  fetchGitStatus,
  fetchRemotes,
  fetchStashes,
  type GitBranch,
  type GitCommit,
  type GitFileChange,
  type GitStash,
  type GitStatus,
  mergeBranch,
  pullBranch,
  pushBranch,
  resolveConflict,
  setStagedContent,
  stageFiles,
  stashAction,
  stashChanges,
  switchBranch,
  undoLastCommit,
  unstageFiles,
} from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"

interface GitState {
  status: GitStatus | null
  commits: GitCommit[]
  branches: GitBranch[]
  stashes: GitStash[]
  /** What a long-running sync is doing ("Pulling"), for the panel to show. */
  syncing: string | null
  /** Message from the last failed call; cleared by the next success. */
  error: string | null
  busy: boolean
  refresh(): Promise<void>
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  /** Throws away unstaged changes to these files (new files are deleted). */
  discard(paths: string[]): Promise<void>
  /** Sets a file's staged content, for staging or unstaging a single change. */
  setStaged(path: string, content: string): Promise<boolean>
  /**
   * Commits what's staged; resolves false (with `error` set) when it didn't.
   * `all` stages every change first, `amend` rewrites the last commit, and
   * `then` pushes or syncs once committed.
   */
  commit(
    message: string,
    opts?: { amend?: boolean; all?: boolean; then?: "push" | "sync" | undefined },
  ): Promise<boolean>
  undoCommit(): Promise<void>
  /** Pulls, then pushes. */
  sync(): Promise<void>
  stash(opts?: { message?: string; untracked?: boolean }): Promise<void>
  stashAction(index: number, action: "apply" | "pop" | "drop"): Promise<void>
  loadBranches(): Promise<void>
  switchTo(branch: string): Promise<boolean>
  createBranch(name: string, from?: string): Promise<boolean>
  fetch(): Promise<void>
  pull(): Promise<void>
  push(opts?: { force?: boolean }): Promise<void>
  merge(branch: string): Promise<boolean>
  abortMerge(): Promise<void>
  resolve(path: string, how: { content: string } | { take: "ours" | "theirs" }): Promise<boolean>
}

let inFlight: Promise<void> | null = null

export const useGitStore = create<GitState>((set, get) => {
  const act = async (fn: () => Promise<GitStatus>) => {
    set({ busy: true })
    try {
      set({ status: await fn(), error: null })
    } catch (e) {
      set({ error: (e as Error).message })
    } finally {
      set({ busy: false })
    }
  }
  /** Runs a repo-changing call, then reloads status, history and branches. */
  const sync = async (label: string, fn: () => Promise<GitStatus>): Promise<boolean> => {
    set({ busy: true, syncing: label })
    try {
      set({ status: await fn(), error: null })
      return true
    } catch (e) {
      set({ error: (e as Error).message })
      return false
    } finally {
      set({ busy: false, syncing: null })
      await Promise.all([get().refresh(), get().loadBranches()])
    }
  }
  return {
    status: null,
    commits: [],
    branches: [],
    stashes: [],
    syncing: null,
    error: null,
    busy: false,
    refresh() {
      if (inFlight) return inFlight
      inFlight = Promise.all([fetchGitStatus(), fetchGitLog(), fetchStashes().catch(() => [])])
        .then(([status, commits, stashes]) => set({ status, commits, stashes, error: null }))
        .catch((e: Error) => set({ error: e.message }))
        .finally(() => {
          inFlight = null
        })
      return inFlight
    },
    stage: (paths) => act(() => stageFiles(paths)),
    unstage: (paths) => act(() => unstageFiles(paths)),
    discard: (paths) => act(() => discardChanges(paths)),
    async setStaged(path, content) {
      await act(() => setStagedContent(path, content))
      return get().error === null
    },
    async loadBranches() {
      try {
        set({ branches: await fetchGitBranches() })
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },
    switchTo: (branch) => sync("Switching branch", () => switchBranch({ branch })),
    createBranch: (name, from) =>
      sync("Creating branch", () => switchBranch(from ? { create: name, from } : { create: name })),
    fetch: async () => void (await sync("Fetching", fetchRemotes)),
    pull: async () => void (await sync("Pulling", pullBranch)),
    push: async (opts = {}) =>
      void (await sync(opts.force ? "Force pushing" : "Pushing", () => pushBranch(opts))),
    merge: (branch) => sync(`Merging ${branch}`, () => mergeBranch(branch)),
    abortMerge: async () => void (await sync("Aborting merge", abortMerge)),
    resolve: (path, how) => sync(`Resolving ${path}`, () => resolveConflict(path, how)),
    undoCommit: async () => void (await sync("Undoing commit", undoLastCommit)),
    async sync() {
      if (await sync("Pulling", pullBranch)) {
        // A pull that stopped on conflicts leaves a merge to finish first.
        const status = get().status
        if (status?.repo && status.merging) return
        await sync("Pushing", () => pushBranch())
      }
    },
    stash: async (opts = {}) => void (await sync("Stashing", () => stashChanges(opts))),
    stashAction: async (index, action) =>
      void (await sync(action === "drop" ? "Dropping stash" : "Applying stash", () =>
        stashAction(index, action),
      )),
    async commit(message, opts = {}) {
      set({ busy: true })
      try {
        await commitStaged(message, { amend: opts.amend === true, all: opts.all === true })
        set({ error: null })
      } catch (e) {
        set({ error: (e as Error).message })
        return false
      } finally {
        set({ busy: false })
        await get().refresh()
      }
      if (opts.then === "push") await get().push()
      if (opts.then === "sync") await get().sync()
      return true
    },
  }
})

/** Test helper. */
export function resetGitStore(): void {
  inFlight = null
  useGitStore.setState({
    status: null,
    commits: [],
    branches: [],
    stashes: [],
    syncing: null,
    error: null,
    busy: false,
  })
}

/** Conflict marks, one per path, so store selectors see a stable value. */
const conflictMarks = new Map<string, GitFileChange>()

/** How a file differs from the last commit, preferring what's on disk over what's staged. */
export function fileChange(status: GitStatus | null, path: string): GitFileChange | undefined {
  if (!status?.repo) return undefined
  if (status.conflicts.some((c) => c.path === path)) {
    let mark = conflictMarks.get(path)
    if (!mark) {
      mark = { path, status: "C" }
      conflictMarks.set(path, mark)
    }
    return mark
  }
  return status.changes.find((c) => c.path === path) ?? status.staged.find((c) => c.path === path)
}

/** Refresh after this long without another file change. */
const DEBOUNCE_MS = 400
/** Also re-read every so often, for git commands run outside the IDE. */
const POLL_MS = 15_000

/**
 * Keeps git status current while the IDE is open: after file changes, when
 * the window regains focus, and on a slow poll. Mount once.
 */
export function useGitWatcher(): void {
  useEffect(() => {
    const refresh = () => void useGitStore.getState().refresh()
    refresh()
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribeToFileEvents(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(refresh, DEBOUNCE_MS)
    })
    const poll = setInterval(refresh, POLL_MS)
    window.addEventListener("focus", refresh)
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
      clearInterval(poll)
      window.removeEventListener("focus", refresh)
    }
  }, [])
}

/** How each status letter reads, and its colour. */
export const GIT_LABEL: Record<GitFileChange["status"], { title: string; className: string }> = {
  M: { title: "Modified", className: "text-warning" },
  A: { title: "Added", className: "text-success" },
  U: { title: "New, not yet staged", className: "text-success" },
  D: { title: "Deleted", className: "text-destructive" },
  R: { title: "Renamed", className: "text-info" },
  C: { title: "Conflict", className: "text-destructive" },
}
