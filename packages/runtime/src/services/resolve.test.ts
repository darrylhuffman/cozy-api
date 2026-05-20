import { describe, expect, it, vi } from "vitest"
import { disposeServices } from "./dispose.js"
import { createServiceResolver } from "./resolve.js"

describe("createServiceResolver", () => {
  it("returns plain values as-is", async () => {
    const r = createServiceResolver({ db: { kind: "db" } })
    const resolved = await r.resolve({ requestId: "1", timestamp: 0 })
    expect(resolved.db).toEqual({ kind: "db" })
  })

  it("calls factories with the context", async () => {
    const factory = vi.fn((ctx: { requestId: string }) => ({ id: ctx.requestId }))
    const r = createServiceResolver({ logger: factory })
    const resolved = await r.resolve({ requestId: "abc", timestamp: 1 })
    expect(factory).toHaveBeenCalledOnce()
    expect(resolved.logger).toEqual({ id: "abc" })
  })

  it("singletons reuse the same instance across resolve() calls", async () => {
    const value = { shared: true }
    const r = createServiceResolver({ db: value })
    const r1 = await r.resolve({ requestId: "1", timestamp: 0 })
    const r2 = await r.resolve({ requestId: "2", timestamp: 0 })
    expect(r1.db).toBe(r2.db)
  })

  it("factories return a fresh instance per call", async () => {
    let counter = 0
    const r = createServiceResolver({ logger: () => ({ n: ++counter }) })
    const r1 = await r.resolve({ requestId: "1", timestamp: 0 })
    const r2 = await r.resolve({ requestId: "2", timestamp: 0 })
    expect(r1.logger).not.toBe(r2.logger)
    expect((r1.logger as { n: number }).n).toBe(1)
    expect((r2.logger as { n: number }).n).toBe(2)
  })

  it("awaits async factories", async () => {
    const r = createServiceResolver({
      logger: async (ctx) => ({ id: ctx.requestId }),
    })
    const resolved = await r.resolve({ requestId: "x", timestamp: 0 })
    expect(resolved.logger).toEqual({ id: "x" })
  })
})

describe("disposeServices", () => {
  it("calls dispose() on each disposable", async () => {
    const disposeA = vi.fn()
    const disposeB = vi.fn()
    await disposeServices({ a: { dispose: disposeA }, b: { dispose: disposeB }, c: {} })
    expect(disposeA).toHaveBeenCalledOnce()
    expect(disposeB).toHaveBeenCalledOnce()
  })

  it("awaits async dispose()", async () => {
    let done = false
    await disposeServices({
      a: {
        dispose: async () => {
          await new Promise((r) => setTimeout(r, 5))
          done = true
        },
      },
    })
    expect(done).toBe(true)
  })

  it("one dispose() throw does not skip the others", async () => {
    const okDispose = vi.fn()
    await disposeServices({
      bad: {
        dispose: () => {
          throw new Error("nope")
        },
      },
      ok: { dispose: okDispose },
    })
    expect(okDispose).toHaveBeenCalledOnce()
  })
})
