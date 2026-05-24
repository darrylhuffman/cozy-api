import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDebugSessionStore } from "../store/debug-session"
import { useDebugTransport } from "./use-debug-transport"

class FakeWS {
  static instances: FakeWS[] = []
  url: string
  readyState = 0
  OPEN = 1
  onopen: (() => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  constructor(url: string) {
    this.url = url
    FakeWS.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
}

// Reset module-level singleton between tests by re-importing with a cache bust
// We do this by directly patching the module singleton via the test reset helper.
// Since we can't easily reach module internals, we rely on unmounting all hooks
// between tests so the refCount reaches 0 and singleton is nulled out.

beforeEach(() => {
  FakeWS.instances = []
  vi.stubGlobal("WebSocket", FakeWS as never)
  useDebugSessionStore.setState(useDebugSessionStore.getInitialState())
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("useDebugTransport", () => {
  it("opens a WS to debugWsUrl() and sends hello on open with current breakpoints", () => {
    useDebugSessionStore.getState().setBreakpoints([
      { workflowPath: "wf", nodeId: "n1", kind: "before" },
    ])
    const { unmount } = renderHook(() => useDebugTransport())
    expect(FakeWS.instances.length).toBe(1)
    const ws = FakeWS.instances[0]!
    act(() => {
      ws.readyState = 1
      ws.onopen?.()
    })
    const helloRaw = ws.sent[0]
    expect(helloRaw).toBeDefined()
    const hello = JSON.parse(helloRaw!) as { type: string; breakpoints: unknown[] }
    expect(hello.type).toBe("hello")
    expect(hello.breakpoints).toEqual([
      { workflowPath: "wf", nodeId: "n1", kind: "before" },
    ])
    unmount()
  })

  it("dispatches inbound 'ready' into the store", () => {
    const { unmount } = renderHook(() => useDebugTransport())
    const ws = FakeWS.instances[0]!
    act(() => {
      ws.readyState = 1
      ws.onopen?.()
    })
    act(() => {
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "ready", sessionId: "s-1" }),
        }),
      )
    })
    expect(useDebugSessionStore.getState().connected).toBe(true)
    unmount()
  })

  it("two consecutive mounts share a single WebSocket connection", () => {
    const { unmount: unmount1 } = renderHook(() => useDebugTransport())
    const { unmount: unmount2 } = renderHook(() => useDebugTransport())
    // Only one WebSocket should have been constructed
    expect(FakeWS.instances.length).toBe(1)
    unmount1()
    unmount2()
  })

  it("WebSocket is closed when the last mount unmounts", () => {
    const { unmount } = renderHook(() => useDebugTransport())
    const ws = FakeWS.instances[0]!
    expect(ws.readyState).toBe(0) // not yet open
    unmount()
    expect(ws.readyState).toBe(3) // closed
  })

  it("reconnect after disconnect doesn't inflate refCount; mount/unmount still closes WS", () => {
    vi.useFakeTimers()

    const { unmount } = renderHook(() => useDebugTransport())
    const first = FakeWS.instances[0]!

    act(() => {
      first.readyState = 1
      first.onopen?.()
    })

    // Simulate a disconnect — triggers the reconnect timer
    act(() => {
      first.readyState = 3
      // Call onclose directly (bypass FakeWS.close() which would loop)
      first.onclose?.()
    })

    // Advance past the first backoff (1000ms) so the reconnect fires
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // A second WebSocket should have been created for the reconnect
    expect(FakeWS.instances.length).toBe(2)

    // Now unmount — refCount should still be 1, so the latest WS gets closed
    unmount()

    const latest = FakeWS.instances[FakeWS.instances.length - 1]!
    expect(latest.readyState).toBe(3)
  })
})
