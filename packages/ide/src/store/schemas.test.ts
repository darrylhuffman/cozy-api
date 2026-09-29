import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, fetchWorkspaceSchemas: vi.fn() }
})
vi.mock("@/lib/events", () => ({ subscribeToFileEvents: vi.fn(() => () => {}) }))

import { fetchWorkspaceSchemas, type NodeSchemas } from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"
import {
  resetSchemasStore,
  SCHEMA_REFRESH_DEBOUNCE_MS,
  useSchemas,
  useSchemasStore,
} from "./schemas"

const schema = (name: string): NodeSchemas => ({ name, inputs: {}, outputs: {} })

beforeEach(() => {
  resetSchemasStore()
  vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({ "./a": schema("A") })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe("schemas store", () => {
  it("loads once and shares the result across consumers", async () => {
    const a = renderHook(() => useSchemas())
    const b = renderHook(() => useSchemas())
    await waitFor(() => expect(a.result.current["./a"]?.name).toBe("A"))
    expect(b.result.current["./a"]?.name).toBe("A")
    expect(fetchWorkspaceSchemas).toHaveBeenCalledTimes(1)
  })

  it("concurrent refreshes share one request", async () => {
    await Promise.all([useSchemasStore.getState().refresh(), useSchemasStore.getState().refresh()])
    expect(fetchWorkspaceSchemas).toHaveBeenCalledTimes(1)
  })

  it("keeps the last good schemas and records the error when a refresh fails", async () => {
    await useSchemasStore.getState().refresh()
    vi.mocked(fetchWorkspaceSchemas).mockRejectedValueOnce(new Error("worker crashed"))
    await useSchemasStore.getState().refresh()
    const s = useSchemasStore.getState()
    expect(s.schemas["./a"]?.name).toBe("A")
    expect(s.error).toBe("worker crashed")
    await useSchemasStore.getState().refresh()
    expect(useSchemasStore.getState().error).toBeNull()
  })

  it("refreshes (debounced) when a node file changes while mounted, and stops after unmount", async () => {
    const { unmount } = renderHook(() => useSchemas())
    await waitFor(() => expect(fetchWorkspaceSchemas).toHaveBeenCalledTimes(1))
    const listener = vi.mocked(subscribeToFileEvents).mock.calls[0]![0]
    vi.useFakeTimers()
    act(() => {
      listener({ type: "change", path: "nodes/a.ts" })
      listener({ type: "change", path: "nodes/a.ts" })
      listener({ type: "change", path: "workflows/x.workflow" })
    })
    await act(async () => {
      vi.advanceTimersByTime(SCHEMA_REFRESH_DEBOUNCE_MS + 10)
    })
    expect(fetchWorkspaceSchemas).toHaveBeenCalledTimes(2)
    unmount()
    const unsub = vi.mocked(subscribeToFileEvents).mock.results[0]!.value as () => void
    expect(typeof unsub).toBe("function")
  })
})
