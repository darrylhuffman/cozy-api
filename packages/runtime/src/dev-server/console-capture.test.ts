import { afterEach, describe, expect, it, vi } from "vitest"
import { installConsoleCapture, withRunContext } from "./console-capture.js"

describe("console-capture", () => {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  }

  afterEach(() => {
    console.log = original.log
    console.info = original.info
    console.warn = original.warn
    console.error = original.error
  })

  it("captures console.log inside withRunContext with the runId", () => {
    const captured: Array<{ runId: string; level: string; message: string }> = []
    installConsoleCapture((e) => captured.push(e))

    void withRunContext("r1", async () => {
      console.log("hello", 42)
    })
    return new Promise<void>((resolve) =>
      queueMicrotask(() => {
        expect(captured).toEqual([
          { runId: "r1", level: "log", message: "hello 42" },
        ])
        resolve()
      }),
    )
  })

  it("captures info / warn / error levels", async () => {
    const captured: Array<{ level: string; message: string }> = []
    installConsoleCapture(({ level, message }) => captured.push({ level, message }))

    await withRunContext("r1", async () => {
      console.info("i")
      console.warn("w")
      console.error("e")
    })
    expect(captured.map((c) => c.level)).toEqual(["info", "warn", "error"])
  })

  it("logs outside any run context fall through to original (no capture)", () => {
    const captured: Array<unknown> = []
    installConsoleCapture((e) => captured.push(e))
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    console.log("nope")
    expect(captured.length).toBe(0)
    logSpy.mockRestore()
  })

  it("formats Error arguments using their stack", async () => {
    const captured: Array<{ message: string }> = []
    installConsoleCapture(({ message }) => captured.push({ message }))
    await withRunContext("r1", async () => {
      console.log(new Error("boom"))
    })
    expect(captured[0]?.message).toMatch(/boom/)
    expect(captured[0]?.message).toMatch(/Error: boom/)
  })

  it("propagates through await", async () => {
    const captured: Array<{ runId: string }> = []
    installConsoleCapture(({ runId }) => captured.push({ runId }))
    await withRunContext("r1", async () => {
      await new Promise((r) => setTimeout(r, 1))
      console.log("after-await")
    })
    expect(captured).toEqual([{ runId: "r1" }])
  })

  it("isolates concurrent contexts", async () => {
    const captured: Array<{ runId: string; message: string }> = []
    installConsoleCapture(({ runId, message }) => captured.push({ runId, message }))

    const a = withRunContext("a", async () => {
      await new Promise((r) => setTimeout(r, 5))
      console.log("from-a")
    })
    const b = withRunContext("b", async () => {
      await new Promise((r) => setTimeout(r, 2))
      console.log("from-b")
    })
    await Promise.all([a, b])
    expect(captured.find((c) => c.message === "from-a")?.runId).toBe("a")
    expect(captured.find((c) => c.message === "from-b")?.runId).toBe("b")
  })
})
