import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// We need to intercept EventSource construction. The FakeEventSource in test-setup
// is a no-op — here we replace it with a controllable version per test.

type EventHandler = (e: MessageEvent) => void

interface FakeESInstance {
  url: string
  handlers: Map<string, EventHandler[]>
  dispatchMessage(event: string, data: string): void
  addEventListener(event: string, handler: EventHandler): void
  removeEventListener(event: string, handler: EventHandler): void
  close(): void
}

let lastFakeSource: FakeESInstance | null = null

class ControllableFakeEventSource implements FakeESInstance {
  url: string
  handlers = new Map<string, EventHandler[]>()

  constructor(url: string) {
    this.url = url
    lastFakeSource = this
  }

  addEventListener(event: string, handler: EventHandler) {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
  }

  removeEventListener(event: string, handler: EventHandler) {
    const list = this.handlers.get(event) ?? []
    this.handlers.set(
      event,
      list.filter((h) => h !== handler),
    )
  }

  close() {}

  dispatchMessage(event: string, data: string) {
    const msg = new MessageEvent(event, { data })
    for (const h of this.handlers.get(event) ?? []) {
      h(msg)
    }
  }
}

beforeEach(() => {
  lastFakeSource = null
  // Replace the global EventSource with our controllable version
  globalThis.EventSource = ControllableFakeEventSource as unknown as typeof EventSource
  // Reset the module so the singleton `source` is null before each test
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("subscribeToFileEvents", () => {
  it("calls listener when a change event arrives", async () => {
    const { subscribeToFileEvents } = await import("./events.js")

    const received: { type: string; path: string }[] = []
    subscribeToFileEvents((e) => received.push(e))

    expect(lastFakeSource).not.toBeNull()

    lastFakeSource!.dispatchMessage(
      "change",
      JSON.stringify({ path: "workflows/users/create.workflow" }),
    )

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ type: "change", path: "workflows/users/create.workflow" })
  })

  it("calls listener for add and unlink events", async () => {
    const { subscribeToFileEvents } = await import("./events.js")

    const received: { type: string; path: string }[] = []
    subscribeToFileEvents((e) => received.push(e))

    lastFakeSource!.dispatchMessage("add", JSON.stringify({ path: "nodes/new.ts" }))
    lastFakeSource!.dispatchMessage("unlink", JSON.stringify({ path: "nodes/old.ts" }))

    expect(received).toEqual([
      { type: "add", path: "nodes/new.ts" },
      { type: "unlink", path: "nodes/old.ts" },
    ])
  })

  it("unsubscribe removes the listener", async () => {
    const { subscribeToFileEvents } = await import("./events.js")

    const received: string[] = []
    const unsub = subscribeToFileEvents((e) => received.push(e.path))
    unsub()

    lastFakeSource!.dispatchMessage("change", JSON.stringify({ path: "workflows/x.workflow" }))

    expect(received).toHaveLength(0)
  })

  it("multiple subscribers each receive events independently", async () => {
    const { subscribeToFileEvents } = await import("./events.js")

    const a: string[] = []
    const b: string[] = []
    subscribeToFileEvents((e) => a.push(e.path))
    subscribeToFileEvents((e) => b.push(e.path))

    lastFakeSource!.dispatchMessage("change", JSON.stringify({ path: "workflows/test.workflow" }))

    expect(a).toEqual(["workflows/test.workflow"])
    expect(b).toEqual(["workflows/test.workflow"])
  })

  it("reuses the same EventSource connection for multiple subscribers", async () => {
    const { subscribeToFileEvents } = await import("./events.js")

    const constructCount = { n: 0 }
    const OrigFake = ControllableFakeEventSource
    class CountingFake extends OrigFake {
      constructor(url: string) {
        super(url)
        constructCount.n++
      }
    }
    globalThis.EventSource = CountingFake as unknown as typeof EventSource

    subscribeToFileEvents(() => {})
    subscribeToFileEvents(() => {})
    subscribeToFileEvents(() => {})

    // Only one EventSource should be created
    expect(constructCount.n).toBeLessThanOrEqual(1)
  })

  it("ignores malformed SSE data without throwing", async () => {
    const { subscribeToFileEvents } = await import("./events.js")

    const received: unknown[] = []
    subscribeToFileEvents((e) => received.push(e))

    // Dispatch an event with invalid JSON
    lastFakeSource!.dispatchMessage("change", "not-json-{{{")

    expect(received).toHaveLength(0) // malformed → silently ignored
  })
})
