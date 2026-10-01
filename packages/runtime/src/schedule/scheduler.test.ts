import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startSchedule } from "./scheduler.js"

describe("startSchedule", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-01T10:07:30Z"))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("runs at each scheduled time with that time", async () => {
    const seen: string[] = []
    const handle = startSchedule({ cron: "*/15 * * * *", run: (at) => seen.push(at.toISOString()) })
    expect(handle.next()?.toISOString()).toBe("2026-10-01T10:15:00.000Z")
    await vi.advanceTimersByTimeAsync(31 * 60_000)
    expect(seen).toEqual(["2026-10-01T10:15:00.000Z", "2026-10-01T10:30:00.000Z"])
    handle.stop()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(seen).toHaveLength(2)
    expect(handle.next()).toBeNull()
  })

  it("skips a run while the previous one is still going", async () => {
    let calls = 0
    const skipped: string[] = []
    const handle = startSchedule(
      { cron: "* * * * *", run: () => new Promise(() => void calls++) },
      { onSkip: (at) => skipped.push(at.toISOString()) },
    )
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(calls).toBe(1)
    expect(skipped).toEqual(["2026-10-01T10:09:00.000Z", "2026-10-01T10:10:00.000Z"])
    handle.stop()
  })

  it("reports a failed run and keeps going", async () => {
    const errors: string[] = []
    let calls = 0
    const handle = startSchedule(
      {
        cron: "* * * * *",
        run: () => {
          calls++
          throw new Error("boom")
        },
      },
      { onError: (err) => errors.push((err as Error).message) },
    )
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(calls).toBe(2)
    expect(errors).toEqual(["boom", "boom"])
    handle.stop()
  })

  it("waits more than setTimeout's limit by re-arming", async () => {
    const seen: string[] = []
    const handle = startSchedule({ cron: "0 0 1 1 *", run: (at) => seen.push(at.toISOString()) })
    await vi.advanceTimersByTimeAsync(40 * 24 * 60 * 60_000)
    expect(seen).toEqual([])
    await vi.advanceTimersByTimeAsync(70 * 24 * 60 * 60_000)
    expect(seen).toEqual(["2027-01-01T00:00:00.000Z"])
    handle.stop()
  })
})
