import { useEffect } from "react"
import { create } from "zustand"
import {
  abortMerge,
  commitStaged,
  fetchGitBranches,
  fetchGitLog,
  fetchGitStatus,
  fetchRemotes,
  type GitBranch,
  type GitCommit,
  type GitFileChange,
  type GitStatus,
  mergeBranch,
  pullBranch,
  pushBranch,
  resolveConflict,
  stageFiles,
  switchBranch,
  unstageFiles,
} from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"

interface GitState {
  status: GitStatus | null
  commits: GitCommit[]
  branches: GitBranch[]
  /** What a long-running sync is doing ("Pulling"), for the panel to show. */
  syncing: string | null
  /** Message from the last failed call; cleared by the next success. */
  error: string | null
  busy: boolean
  refresh(): Promise<void>
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  /** Commits what's staged; resolves false (with `error` set) when it didn't. */
  commit(message: string): Promise<boolean>
  loadBranches(): Promise<void>
  switchTo(branch: string): Promise<boolean>
  createBranch(name: string, from?: string): Promise<boolean>
  fetch(): Promise<void>
  pull(): Promise<void>
  push(): Promise<void>
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
    syncing: null,
    error: null,
    busy: false,
    refresh() {
      if (inFlight) return inFlight
      inFlight = Promise.all([fetchGitStatus(), fetchGitLog()])
        .then(([status, commits]) => set({ status, commits, error: null }))
        .catch((e: Error) => set({ error: e.message }))
        .finally(() => {
          inFlight = null
        })
      return inFlight
    },
    stage: (paths) => act(() => stageFiles(paths)),
    unstage: (paths) => act(() => unstageFiles(paths)),
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
    push: async () => void (await sync("Pushing", pushBranch)),
    merge: (branch) => sync(`Merging ${branch}`, () => mergeBranch(branch)),
    abortMerge: async () => void (await sync("Aborting merge", abortMerge)),
    resolve: (path, how) => sync(`Resolving ${path}`, () => resolveConflict(path, how)),
    async commit(message) {
      set({ busy: true })
      try {
        await commitStaged(message)
        set({ error: null })
        await get().refresh()
        return true
      } catch (e) {
        set({ error: (e as Error).message })
        return false
      } finally {
        set({ busy: false })
      }
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
