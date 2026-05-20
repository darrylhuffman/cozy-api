import { describe, expect, it, vi } from "vitest"
import { LifecycleEmitter } from "./lifecycle.js"

describe("LifecycleEmitter", () => {
  it("calls subscribers when events fire", () => {
    const emitter = new LifecycleEmitter()
    const onBefore = vi.fn()
    emitter.on("before-node", onBefore)
    emitter.emit({ type: "before-node", nodeId: "n1", input: { a: 1 } })
    expect(onBefore).toHaveBeenCalledWith({ type: "before-node", nodeId: "n1", input: { a: 1 } })
  })

  it("supports multiple subscribers per event", () => {
    const emitter = new LifecycleEmitter()
    const s1 = vi.fn()
    const s2 = vi.fn()
    emitter.on("after-node", s1)
    emitter.on("after-node", s2)
    emitter.emit({ type: "after-node", nodeId: "n", output: {}, durationMs: 5 })
    expect(s1).toHaveBeenCalledOnce()
    expect(s2).toHaveBeenCalledOnce()
  })

  it("unsubscribe stops further events", () => {
    const emitter = new LifecycleEmitter()
    const handler = vi.fn()
    const off = emitter.on("complete", handler)
    off()
    emitter.emit({ type: "complete", totalMs: 1 })
    expect(handler).not.toHaveBeenCalled()
  })

  it("a subscriber error does not stop other subscribers", () => {
    const emitter = new LifecycleEmitter()
    const throwing = vi.fn(() => {
      throw new Error("boom")
    })
    const ok = vi.fn()
    emitter.on("before-node", throwing)
    emitter.on("before-node", ok)
    emitter.emit({ type: "before-node", nodeId: "x", input: {} })
    expect(ok).toHaveBeenCalledOnce()
  })
})
