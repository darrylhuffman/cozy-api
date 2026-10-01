import { describe, expect, it } from "vitest"
import { cronProblem, describeCron, nextCronTime, nextCronTimes, parseCron } from "./cron.js"

const iso = (dates: Date[]) => dates.map((d) => d.toISOString())

describe("parseCron", () => {
  it("expands lists, ranges, steps and names", () => {
    const s = parseCron("*/15 9-17/4 1,15 JAN-MAR mon-fri")
    expect(s.minutes).toEqual([0, 15, 30, 45])
    expect(s.hours).toEqual([9, 13, 17])
    expect(s.daysOfMonth).toEqual([1, 15])
    expect(s.months).toEqual([1, 2, 3])
    expect(s.daysOfWeek).toEqual([1, 2, 3, 4, 5])
  })

  it("treats 7 as Sunday and expands macros", () => {
    expect(parseCron("0 0 * * 7").daysOfWeek).toEqual([0])
    expect(parseCron("@daily").fields).toEqual(["0", "0", "*", "*", "*"])
  })

  it("says which field is wrong", () => {
    expect(() => parseCron("61 * * * *")).toThrow("Minute: 61 is out of range (0-59)")
    expect(() => parseCron("* * * *")).toThrow("Expected 5 fields")
    expect(() => parseCron("* * * * FUNDAY")).toThrow('Day of week: "FUNDAY" is not a number')
    expect(() => parseCron("*/0 * * * *")).toThrow("step")
    expect(() => parseCron("5-1 * * * *")).toThrow("backwards")
  })
})

describe("cronProblem", () => {
  it("accepts a good schedule and time zone", () => {
    expect(cronProblem("0 9 * * 1-5", "Europe/London")).toBeNull()
  })
  it("rejects an unknown time zone and impossible dates", () => {
    expect(cronProblem("0 9 * * *", "Mars/Olympus")).toBe('Unknown time zone "Mars/Olympus"')
    expect(cronProblem("0 0 30 2 *")).toMatch(/never runs/)
  })
})

describe("nextCronTimes", () => {
  const from = new Date("2026-10-01T10:07:30Z") // a Thursday

  it("finds the next minutes", () => {
    expect(iso(nextCronTimes("*/15 * * * *", from, 3))).toEqual([
      "2026-10-01T10:15:00.000Z",
      "2026-10-01T10:30:00.000Z",
      "2026-10-01T10:45:00.000Z",
    ])
  })

  it("skips to the next matching weekday", () => {
    expect(iso(nextCronTimes("0 9 * * 1-5", from, 3))).toEqual([
      "2026-10-02T09:00:00.000Z",
      "2026-10-05T09:00:00.000Z",
      "2026-10-06T09:00:00.000Z",
    ])
  })

  it("rolls over months and years", () => {
    expect(iso(nextCronTimes("0 0 1 1 *", from, 2))).toEqual([
      "2027-01-01T00:00:00.000Z",
      "2028-01-01T00:00:00.000Z",
    ])
    expect(nextCronTime("0 12 29 2 *", from)?.toISOString()).toBe("2028-02-29T12:00:00.000Z")
  })

  it("runs on either day when both day fields are restricted", () => {
    // The 13th, or any Friday.
    expect(iso(nextCronTimes("0 0 13 * 5", from, 3))).toEqual([
      "2026-10-02T00:00:00.000Z",
      "2026-10-09T00:00:00.000Z",
      "2026-10-13T00:00:00.000Z",
    ])
  })

  it("is strictly after the given time", () => {
    const at = new Date("2026-10-01T09:00:00Z")
    expect(nextCronTime("0 9 * * *", at)?.toISOString()).toBe("2026-10-02T09:00:00.000Z")
  })

  it("reads times in the schedule's time zone, across DST", () => {
    // 09:00 in New York is 13:00 UTC in summer (EDT) and 14:00 in winter (EST).
    expect(
      iso(nextCronTimes("0 9 * * *", new Date("2026-10-30T12:00:00Z"), 4, "America/New_York")),
    ).toEqual([
      "2026-10-30T13:00:00.000Z",
      "2026-10-31T13:00:00.000Z",
      "2026-11-01T14:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
    ])
  })

  it("still runs on the day clocks go forward", () => {
    // London skips 01:00-02:00 on 2027-03-28; 00:30 and 03:30 both exist.
    const runs = nextCronTimes("30 0,3 * * *", new Date("2027-03-27T12:00:00Z"), 3, "Europe/London")
    expect(iso(runs)).toEqual([
      "2027-03-28T00:30:00.000Z",
      "2027-03-28T02:30:00.000Z", // 03:30 BST
      "2027-03-28T23:30:00.000Z", // 00:30 BST the next day
    ])
  })
})

describe("describeCron", () => {
  it.each([
    ["* * * * *", "Every minute"],
    ["*/15 * * * *", "Every 15 minutes"],
    ["0 * * * *", "Every hour"],
    ["30 * * * *", "Every hour at :30"],
    ["0 */6 * * *", "Every 6 hours"],
    ["0 9 * * *", "Every day at 09:00"],
    ["30 17 * * 1-5", "Every weekday at 17:30"],
    ["0 10 * * 0,6", "Every Saturday and Sunday at 10:00"],
    ["0 8 * * 1,3,5", "Every Monday, Wednesday and Friday at 08:00"],
    ["0 0 1 * *", "On the 1st of every month at 00:00"],
    ["0 0 1,15 * *", "On the 1st and 15th of every month at 00:00"],
    ["0 0 1 1 *", "On the 1st of January at 00:00"],
    ["0 9,13,17 * * *", "Every day at 09:00, 13:00 and 17:00"],
    ["*/10 * * * 1-5", "Every 10 minutes, on weekdays"],
    ["30 7 * * 1-6", "Every Monday to Saturday at 07:30"],
    ["0 7 * * 0-2,4-6", "Every Sunday to Tuesday and Thursday to Saturday at 07:00"],
  ])("%s → %s", (cron, text) => {
    expect(describeCron(cron)).toBe(text)
  })
})
