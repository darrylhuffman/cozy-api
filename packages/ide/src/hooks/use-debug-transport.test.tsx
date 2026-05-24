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

beforeEach(() => {
  FakeWS.instances = []
  vi.stubGlobal("WebSocket", FakeWS as never)
  useDebugSessionStore.setState(useDebugSessionStore.getInitialState())
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useDebugTransport", () => {
  it("opens a WS to debugWsUrl() and sends hello on open with current breakpoints", () => {
    useDebugSessionStore.getState().setBreakpoints([
      { workflowPath: "wf", nodeId: "n1", kind: "before" },
    ])
    renderHook(() => useDebugTransport())
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
  })

  it("dispatches inbound 'ready' into the store", () => {
    renderHook(() => useDebugTransport())
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
  })
})
