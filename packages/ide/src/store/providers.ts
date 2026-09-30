import { useEffect } from "react"
import { create } from "zustand"
import { fetchWorkspaceProviders, type MiddlewareInfo, type ProviderInfo } from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"

/** Wait this long after the last provider or node change before re-reading. */
export const PROVIDERS_REFRESH_DEBOUNCE_MS = 300

interface ProvidersState {
  providers: ProviderInfo[]
  /** Every `_middleware.ts`, outermost folder first. */
  middleware: MiddlewareInfo[]
  /** Node `uses` key → the providers its `run` reads. */
  nodes: Record<string, string[]>
  loaded: boolean
  loading: boolean
  refresh(): Promise<void>
}

let inFlight: Promise<void> | null = null

const INITIAL = { providers: [], middleware: [], nodes: {}, loaded: false, loading: false }

/**
 * The workspace's providers and which nodes read them, shared by the
 * explorer, the code editor's provider card and the canvas chips. Refreshes
 * itself when files under `providers/` or `nodes/` change.
 */
export const useProvidersStore = create<ProvidersState>((set) => ({
  ...INITIAL,
  refresh() {
    if (inFlight) return inFlight
    set({ loading: true })
    inFlight = Promise.resolve()
      .then(fetchWorkspaceProviders)
      .then((r) =>
        set({
          providers: r?.providers ?? [],
          middleware: r?.middleware ?? [],
          nodes: r?.nodes ?? {},
          loaded: true,
          loading: false,
        }),
      )
      .catch(() => {
        // Older server or offline: nothing to show, keep the last good copy.
        set({ loading: false })
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  },
}))

/** Test helper: forget everything, including any in-flight request. */
export function resetProvidersStore(): void {
  inFlight = null
  useProvidersStore.setState(INITIAL)
}

let consumers = 0
let unsubscribe: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function acquireWatcher(): void {
  consumers++
  if (unsubscribe) return
  unsubscribe = subscribeToFileEvents((e) => {
    const relevant =
      e.path.startsWith("providers/") ||
      e.path.startsWith("nodes/") ||
      /(^|\/)_middleware\.[mc]?[jt]s$/.test(e.path)
    if (!relevant) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void useProvidersStore.getState().refresh()
    }, PROVIDERS_REFRESH_DEBOUNCE_MS)
  })
}

function releaseWatcher(): void {
  consumers = Math.max(0, consumers - 1)
  if (consumers > 0) return
  if (timer) clearTimeout(timer)
  timer = null
  unsubscribe?.()
  unsubscribe = null
}

/** Keeps the shared providers loaded and fresh while the caller is mounted. */
export function useWorkspaceProviders(): void {
  useEffect(() => {
    acquireWatcher()
    const s = useProvidersStore.getState()
    if (!s.loaded && !s.loading) void s.refresh()
    return releaseWatcher
  }, [])
}

/** The provider defined by `path` ("providers/db.ts"), if it is one. */
export function useProviderAt(path: string): ProviderInfo | undefined {
  useWorkspaceProviders()
  return useProvidersStore((s) => s.providers.find((p) => p.path === path))
}

/** The middleware guarding a workflow ("workflows/admin/stats.workflow"), outermost first. */
export function middlewareFor(
  middleware: readonly MiddlewareInfo[],
  workflowPath: string,
): MiddlewareInfo[] {
  const dir = workflowPath.split("/").slice(0, -1).join("/")
  return middleware.filter((m) => dir === m.dir || dir.startsWith(`${m.dir}/`))
}

export const LIFETIME_HELP: Record<ProviderInfo["lifetime"], string> = {
  singleton: "Created once when the app starts and shared by every request.",
  scoped: "Created once per request and disposed when the request ends.",
  transient: "Created fresh every time a node reads it.",
}
