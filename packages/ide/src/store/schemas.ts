import { useEffect } from "react"
import { create } from "zustand"
import { fetchWorkspaceSchemas, type NodeSchemas } from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"

/** Wait this long after the last node-file change before re-introspecting. */
export const SCHEMA_REFRESH_DEBOUNCE_MS = 300

interface SchemasState {
  /** Node input/output schemas keyed by `uses` (e.g. "./nodes/x", "@core/http-response"). */
  schemas: Record<string, NodeSchemas>
  /** True once at least one fetch has succeeded. */
  loaded: boolean
  loading: boolean
  /** Message from the last failed fetch; cleared by the next success. */
  error: string | null
  /** Re-introspect the workspace. Concurrent calls share one request. */
  refresh(): Promise<void>
}

let inFlight: Promise<void> | null = null

const INITIAL = { schemas: {}, loaded: false, loading: false, error: null }

/**
 * One shared copy of the workspace's node schemas for every panel (canvas,
 * inspector, run tab). Refreshes itself when files under `nodes/` change while
 * any consumer is mounted, so ports never go stale after editing a node.
 */
export const useSchemasStore = create<SchemasState>((set) => ({
  ...INITIAL,
  refresh() {
    if (inFlight) return inFlight
    set({ loading: true })
    inFlight = fetchWorkspaceSchemas()
      .then((schemas) => {
        set({ schemas, loaded: true, loading: false, error: null })
      })
      .catch((e: Error) => {
        // Keep the last good schemas; consumers fall back to inference.
        set({ loading: false, error: e.message })
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  },
}))

/** Test helper: forget everything, including any in-flight request. */
export function resetSchemasStore(): void {
  inFlight = null
  useSchemasStore.setState(INITIAL)
}

let consumers = 0
let unsubscribe: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function acquireWatcher(): void {
  consumers++
  if (unsubscribe) return
  unsubscribe = subscribeToFileEvents((e) => {
    if (!e.path.startsWith("nodes/")) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void useSchemasStore.getState().refresh()
    }, SCHEMA_REFRESH_DEBOUNCE_MS)
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

/**
 * Subscribe to the shared schemas. Triggers the first fetch if nothing has
 * loaded yet and keeps them fresh while mounted.
 */
export function useSchemas(): Record<string, NodeSchemas> {
  const schemas = useSchemasStore((s) => s.schemas)
  useEffect(() => {
    acquireWatcher()
    const s = useSchemasStore.getState()
    if (!s.loaded && !s.loading) void s.refresh()
    return releaseWatcher
  }, [])
  return schemas
}
