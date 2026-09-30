import { useEffect } from "react"
import { create } from "zustand"
import {
  commitStaged,
  fetchGitLog,
  fetchGitStatus,
  type GitCommit,
  type GitFileChange,
  type GitStatus,
  stageFiles,
  unstageFiles,
} from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"

interface GitState {
  status: GitStatus | null
  commits: GitCommit[]
  /** Message from the last failed call; cleared by the next success. */
  error: string | null
  busy: boolean
  refresh(): Promise<void>
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  /** Commits what's staged; resolves false (with `error` set) when it didn't. */
  commit(message: string): Promise<boolean>
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
  return {
    status: null,
    commits: [],
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
  useGitStore.setState({ status: null, commits: [], error: null, busy: false })
}

/** How a file differs from the last commit, preferring what's on disk over what's staged. */
export function fileChange(status: GitStatus | null, path: string): GitFileChange | undefined {
  if (!status?.repo) return undefined
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
}
