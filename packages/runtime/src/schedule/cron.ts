/**
 * Cron expressions for `@core/schedule`: parsing, the next times one fires,
 * and a plain-English description of it.
 *
 * This file must not import anything. `lorien build` copies its compiled
 * output into the built server as-is, so a deployed server schedules runs
 * without depending on the runtime package.
 *
 * The syntax is classic five-field cron: `minute hour day-of-month month
 * day-of-week`. Fields take `*`, numbers, ranges (`1-5`), lists (`1,15`) and
 * steps (`*\/15`, `9-17/2`); months and weekdays also take names (`JAN`,
 * `MON`), and 7 is Sunday as well as 0. `@hourly`, `@daily`, `@weekly`,
 * `@monthly` and `@yearly` are accepted. As in Vixie cron, when both
 * day-of-month and day-of-week are restricted, a day matching either runs.
 */

export interface CronSchedule {
  minutes: number[]
  hours: number[]
  daysOfMonth: number[]
  months: number[]
  /** 0 is Sunday. */
  daysOfWeek: number[]
  /** Whether each day field was written as `*` (or a `*` step). */
  anyDayOfMonth: boolean
  anyDayOfWeek: boolean
  /** The five fields as written (after expanding a macro). */
  fields: [string, string, string, string, string]
}

export class CronError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CronError"
  }
}

const MONTH_NAMES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
]
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
}

interface FieldSpec {
  label: string
  min: number
  max: number
  names?: string[]
  /** Offset of names[0] (months count from 1). */
  nameBase?: number
}

const FIELDS: FieldSpec[] = [
  { label: "Minute", min: 0, max: 59 },
  { label: "Hour", min: 0, max: 23 },
  { label: "Day of month", min: 1, max: 31 },
  { label: "Month", min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 },
  // 7 is accepted as Sunday and folded to 0 after parsing.
  { label: "Day of week", min: 0, max: 7, names: DAY_NAMES, nameBase: 0 },
]

function parseValue(raw: string, spec: FieldSpec): number {
  const upper = raw.toUpperCase()
  if (spec.names) {
    const i = spec.names.indexOf(upper)
    if (i >= 0) return i + (spec.nameBase ?? 0)
  }
  if (!/^\d+$/.test(raw)) throw new CronError(`${spec.label}: "${raw}" is not a number`)
  const n = Number(raw)
  if (n < spec.min || n > spec.max)
    throw new CronError(`${spec.label}: ${n} is out of range (${spec.min}-${spec.max})`)
  return n
}

function parseField(text: string, spec: FieldSpec): number[] {
  const values = new Set<number>()
  for (const part of text.split(",")) {
    if (part === "") throw new CronError(`${spec.label}: empty list item in "${text}"`)
    const [range, stepText, extra] = part.split("/")
    if (extra !== undefined) throw new CronError(`${spec.label}: "${part}" has more than one /`)
    let step = 1
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) === 0)
        throw new CronError(`${spec.label}: step "${stepText}" must be a whole number above 0`)
      step = Number(stepText)
    }
    let lo: number
    let hi: number
    if (range === "*") {
      lo = spec.min
      hi = spec.label === "Day of week" ? 6 : spec.max
    } else if (range!.includes("-")) {
      const [a, b] = range!.split("-")
      lo = parseValue(a ?? "", spec)
      hi = parseValue(b ?? "", spec)
      if (hi < lo) throw new CronError(`${spec.label}: range "${range}" runs backwards`)
    } else {
      lo = parseValue(range ?? "", spec)
      // "5/15" means "from 5, every 15".
      hi = stepText !== undefined ? spec.max : lo
    }
    for (let v = lo; v <= hi; v += step) values.add(v)
  }
  return [...values].sort((a, b) => a - b)
}

/** Parses a cron expression; throws a CronError that says which field is wrong. */
export function parseCron(expression: string): CronSchedule {
  const trimmed = expression.trim()
  if (trimmed === "") throw new CronError("The schedule is empty")
  const expanded = MACROS[trimmed.toLowerCase()] ?? trimmed
  if (expanded.startsWith("@")) throw new CronError(`Unknown shortcut "${trimmed}"`)
  const parts = expanded.split(/\s+/)
  if (parts.length !== 5)
    throw new CronError(
      `Expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`,
    )
  const [minutes, hours, daysOfMonth, months, rawDays] = parts.map((p, i) =>
    parseField(p, FIELDS[i]!),
  ) as [number[], number[], number[], number[], number[]]
  const daysOfWeek = [...new Set(rawDays.map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b)
  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    anyDayOfMonth: parts[2]!.startsWith("*"),
    anyDayOfWeek: parts[4]!.startsWith("*"),
    fields: parts as CronSchedule["fields"],
  }
}

/** Whether `timeZone` is an IANA zone this JavaScript runtime knows ("Europe/Paris"). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}

/** Why a schedule can't run, or null when it can. */
export function cronProblem(expression: string, timeZone?: string): string | null {
  let schedule: CronSchedule
  try {
    schedule = parseCron(expression)
  } catch (e) {
    return (e as Error).message
  }
  if (timeZone !== undefined && timeZone !== "" && !isValidTimeZone(timeZone))
    return `Unknown time zone "${timeZone}"`
  // "30 2 * *" for February, say: valid fields that never line up.
  if (nextTimes(schedule, new Date(Date.UTC(2000, 0, 1)), 1, "UTC").length === 0)
    return "This schedule never runs (no month has that day)"
  return null
}

interface WallTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function wallTime(ms: number, timeZone: string): WallTime {
  if (timeZone === "UTC") {
    const d = new Date(ms)
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      weekday: d.getUTCDay(),
    }
  }
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    })
    formatters.set(timeZone, f)
  }
  const out: Record<string, string> = {}
  for (const p of f.formatToParts(ms)) out[p.type] = p.value
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    weekday: WEEKDAYS[out.weekday ?? "Sun"] ?? 0,
  }
}

/** The instant a wall-clock time in `timeZone` happens (the later one across a DST gap). */
function instantOf(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute)
  if (timeZone === "UTC") return asUtc
  const offsetAt = (ms: number) => {
    const w = wallTime(ms, timeZone)
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - ms
  }
  const first = asUtc - offsetAt(asUtc)
  const second = asUtc - offsetAt(first)
  return Math.max(first, second)
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function dayMatches(s: CronSchedule, w: WallTime): boolean {
  const dom = s.daysOfMonth.includes(w.day)
  const dow = s.daysOfWeek.includes(w.weekday)
  // Vixie cron: a field written with `*` doesn't widen the other one.
  return s.anyDayOfMonth || s.anyDayOfWeek ? dom && dow : dom || dow
}

const MINUTE = 60_000
/** How far ahead to look before deciding a schedule never runs. */
const HORIZON_MS = 8 * 366 * 24 * 60 * MINUTE

function nextTimes(s: CronSchedule, after: Date, count: number, timeZone: string): Date[] {
  const out: Date[] = []
  // The first whole minute after `after`.
  let t = Math.floor(after.getTime() / MINUTE) * MINUTE + MINUTE
  const limit = t + HORIZON_MS
  while (out.length < count && t < limit) {
    const w = wallTime(t, timeZone)
    if (!s.months.includes(w.month)) {
      const nextMonth = s.months.find((m) => m > w.month)
      t =
        nextMonth === undefined
          ? instantOf(w.year + 1, s.months[0]!, 1, 0, 0, timeZone)
          : instantOf(w.year, nextMonth, 1, 0, 0, timeZone)
      continue
    }
    if (!dayMatches(s, w)) {
      const tomorrow =
        w.day < daysInMonth(w.year, w.month)
          ? [w.year, w.month, w.day + 1]
          : w.month < 12
            ? [w.year, w.month + 1, 1]
            : [w.year + 1, 1, 1]
      t = instantOf(tomorrow[0]!, tomorrow[1]!, tomorrow[2]!, 0, 0, timeZone)
      continue
    }
    if (!s.hours.includes(w.hour)) {
      t += (60 - w.minute) * MINUTE
      continue
    }
    const minute = s.minutes.find((m) => m >= w.minute)
    if (minute === undefined) {
      t += (60 - w.minute) * MINUTE
      continue
    }
    if (minute > w.minute) {
      t += (minute - w.minute) * MINUTE
      continue
    }
    out.push(new Date(t))
    t += MINUTE
  }
  return out
}

/**
 * The next `count` times a schedule fires after `after`, in `timeZone`
 * (default UTC). Fewer when it never fires again within a few years.
 */
export function nextCronTimes(
  expression: string | CronSchedule,
  after: Date,
  count: number,
  timeZone = "UTC",
): Date[] {
  const s = typeof expression === "string" ? parseCron(expression) : expression
  return nextTimes(s, after, count, timeZone || "UTC")
}

/** The next time a schedule fires after `after`, or null if it never does. */
export function nextCronTime(
  expression: string | CronSchedule,
  after: Date,
  timeZone = "UTC",
): Date | null {
  return nextCronTimes(expression, after, 1, timeZone)[0] ?? null
}

// ── Plain English ────────────────────────────────────────────────────────────

const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`
}

/** `*\/n` (or `0/n`) covering the whole field, as n; otherwise null. */
function everyN(field: string): number | null {
  const m = /^(?:\*|0)\/(\d+)$/.exec(field)
  return m ? Number(m[1]) : null
}

function timePhrase(s: CronSchedule): { text: string; repeats: boolean } {
  const [minField, hourField] = s.fields
  const anyHour = hourField === "*"
  const stepMin = everyN(minField)
  const stepHour = everyN(hourField)
  if (minField === "*" && anyHour) return { text: "every minute", repeats: true }
  if (stepMin !== null && anyHour)
    return { text: stepMin === 1 ? "every minute" : `every ${stepMin} minutes`, repeats: true }
  if (s.minutes.length === 1) {
    const m = s.minutes[0]!
    if (anyHour) return { text: m === 0 ? "every hour" : `every hour at :${pad(m)}`, repeats: true }
    if (stepHour !== null)
      return {
        text: `every ${stepHour} hours${m === 0 ? "" : ` at :${pad(m)}`}`,
        repeats: true,
      }
    if (s.hours.length <= 6)
      return { text: `at ${joinList(s.hours.map((h) => `${pad(h)}:${pad(m)}`))}`, repeats: false }
    return {
      text: `at :${pad(m)} past hours ${s.hours.join(", ")}`,
      repeats: true,
    }
  }
  if (anyHour) return { text: `at minutes ${s.minutes.join(", ")} of every hour`, repeats: true }
  if (stepMin !== null && s.hours.length === 1)
    return {
      text: `every ${stepMin} minutes during the ${pad(s.hours[0]!)}:00 hour`,
      repeats: true,
    }
  return {
    text: `at minutes ${s.minutes.join(", ")} past hours ${s.hours.join(", ")}`,
    repeats: true,
  }
}

function weekdayPhrase(days: number[]): { every: string; on: string } {
  const key = days.join(",")
  if (key === "1,2,3,4,5") return { every: "every weekday", on: "on weekdays" }
  if (key === "0,6") return { every: "every Saturday and Sunday", on: "on weekends" }
  // Runs of three or more days read as "Monday to Thursday".
  const parts: string[] = []
  for (let i = 0; i < days.length; ) {
    let j = i
    while (j + 1 < days.length && days[j + 1] === days[j]! + 1) j++
    if (j - i >= 2) parts.push(`${DAY_LONG[days[i]!]} to ${DAY_LONG[days[j]!]}`)
    else for (let k = i; k <= j; k++) parts.push(DAY_LONG[days[k]!]!)
    i = j + 1
  }
  return { every: `every ${joinList(parts)}`, on: `on ${joinList(parts)}` }
}

function monthPhrase(s: CronSchedule): string | null {
  if (s.fields[3] === "*") return null
  return `in ${joinList(s.months.map((m) => MONTH_LONG[m - 1]!))}`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * A plain-English reading of a cron expression: "Every weekday at 09:00",
 * "Every 15 minutes", "On the 1st of every month at 00:00". Times are the
 * schedule's own wall-clock times, in 24-hour form.
 */
export function describeCron(expression: string | CronSchedule): string {
  const s = typeof expression === "string" ? parseCron(expression) : expression
  const time = timePhrase(s)
  const months = monthPhrase(s)
  const domText =
    s.daysOfMonth.length <= 4
      ? joinList(s.daysOfMonth.map(ordinal))
      : `days ${s.daysOfMonth.join(", ")}`
  const dow = s.fields[4] === "*" ? null : weekdayPhrase(s.daysOfWeek)
  const dom = s.fields[2] === "*" ? null : domText

  if (time.repeats) {
    const parts = [capitalize(time.text)]
    if (dom && dow) parts.push(`on the ${dom} or ${dow.on}`)
    else if (dom) parts.push(`on the ${dom}`)
    else if (dow) parts.push(dow.on)
    if (months) parts.push(months)
    return parts.join(", ")
  }

  if (dom && dow)
    return `On the ${dom} of ${months ? months.slice(3) : "the month"}, or ${dow.on}, ${time.text}`
  if (dom) {
    const of = months ? months.slice(3) : "every month"
    return `On the ${dom} of ${of} ${time.text}`
  }
  if (dow) return `${capitalize(dow.every)}${months ? ` ${months}` : ""} ${time.text}`
  return months ? `Every day ${months} ${time.text}` : `Every day ${time.text}`
}
