import { describe, expect, it } from "vitest"
import { cronFromForm, formatFromNow, formFromCron, setScheduleValues } from "./schedule"

describe("formFromCron", () => {
  it.each([
    ["* * * * *", { mode: "minutes", everyMinutes: 1 }],
    ["*/15 * * * *", { mode: "minutes", everyMinutes: 15 }],
    ["30 * * * *", { mode: "hourly", everyHours: 1, minute: 30 }],
    ["0 */6 * * *", { mode: "hourly", everyHours: 6, minute: 0 }],
    ["15 9 * * *", { mode: "daily", hour: 9, minute: 15 }],
    ["0 17 * * 1-5", { mode: "weekly", hour: 17, weekdays: [1, 2, 3, 4, 5] }],
    ["0 8 * * MON,FRI", { mode: "weekly", weekdays: [1, 5] }],
    ["0 0 15 * *", { mode: "monthly", dayOfMonth: 15, hour: 0 }],
  ])("reads %s", (cron, expected) => {
    expect(formFromCron(cron)).toMatchObject(expected)
  })

  it.each([
    "*/7 * * * *", // uneven step
    "0 9 * 1 *", // a month
    "0 9,17 * * *", // two times
    "0 9 1 * 1", // day of month and weekday
    "nonsense",
  ])("leaves %s as custom", (cron) => {
    expect(formFromCron(cron).mode).toBe("custom")
  })
})

describe("cronFromForm", () => {
  it("round-trips every mode", () => {
    for (const cron of [
      "*/5 * * * *",
      "45 */2 * * *",
      "0 9 * * *",
      "30 8 * * 1,3,5",
      "0 6 1 * *",
    ]) {
      expect(cronFromForm(formFromCron(cron))).toBe(cron)
    }
  })

  it("compresses weekday runs into ranges", () => {
    const base = formFromCron("0 9 * * *")
    expect(cronFromForm({ ...base, mode: "weekly", weekdays: [1, 2, 3, 4, 5] })).toBe("0 9 * * 1-5")
    expect(cronFromForm({ ...base, mode: "weekly", weekdays: [0, 1, 2, 4, 5, 6] })).toBe(
      "0 9 * * 0-2,4-6",
    )
    expect(cronFromForm({ ...base, mode: "weekly", weekdays: [0, 6] })).toBe("0 9 * * 0,6")
  })
})

describe("setScheduleValues", () => {
  it("merges into the node's values", () => {
    const wf = {
      lorien: 1 as const,
      nodes: { Nightly: { uses: "@core/schedule", values: { cron: "0 9 * * *" } } },
    }
    expect(
      setScheduleValues(wf, "Nightly", { timezone: "Asia/Tokyo" }).nodes.Nightly?.values,
    ).toEqual({
      cron: "0 9 * * *",
      timezone: "Asia/Tokyo",
    })
  })
})

describe("formatFromNow", () => {
  it("rounds to a readable unit", () => {
    const now = Date.UTC(2026, 9, 1, 12)
    expect(formatFromNow(new Date(now + 5 * 60_000), now)).toBe("in 5 min")
    expect(formatFromNow(new Date(now + 3 * 3_600_000), now)).toBe("in 3 h")
    expect(formatFromNow(new Date(now + 3 * 86_400_000), now)).toBe("in 3 days")
  })
})
