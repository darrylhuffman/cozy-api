import { parseCron } from "@darrylondil/lorien-runtime/schedule"
import type { NodeInstance, WorkflowFile } from "@/lib/api"

export const SCHEDULE_USES = "@core/schedule"
export const DEFAULT_CRON = "0 9 * * *"
export const DEFAULT_TIMEZONE = "UTC"

/** How the schedule editor shows a cron expression. "custom" is anything the others can't say. */
export type ScheduleMode = "minutes" | "hourly" | "daily" | "weekly" | "monthly" | "custom"

export interface ScheduleForm {
  mode: ScheduleMode
  /** minutes: every N minutes. */
  everyMinutes: number
  /** hourly: every N hours. */
  everyHours: number
  /** The minute past the hour (hourly, daily, weekly, monthly). */
  minute: number
  /** daily, weekly, monthly. */
  hour: number
  /** weekly; 0 is Sunday. */
  weekdays: number[]
  /** monthly. */
  dayOfMonth: number
}

/** Steps that divide the hour (or the day) evenly, so runs stay evenly spaced. */
export const MINUTE_STEPS = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30]
export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12]

export const MODES: Array<{ mode: ScheduleMode; label: string }> = [
  { mode: "minutes", label: "Minutes" },
  { mode: "hourly", label: "Hourly" },
  { mode: "daily", label: "Daily" },
  { mode: "weekly", label: "Weekly" },
  { mode: "monthly", label: "Monthly" },
  { mode: "custom", label: "Custom" },
]

const DEFAULT_FORM: ScheduleForm = {
  mode: "daily",
  everyMinutes: 15,
  everyHours: 1,
  minute: 0,
  hour: 9,
  weekdays: [1, 2, 3, 4, 5],
  dayOfMonth: 1,
}

const INT = /^\d+$/
const STEP = /^(?:\*|0)\/(\d+)$/

/** The node's cron and time zone, with the defaults the runtime uses. */
export function scheduleValues(instance: NodeInstance | undefined): {
  cron: string
  timezone: string
} {
  const values = (instance?.values ?? {}) as Record<string, unknown>
  const cron =
    typeof values.cron === "string" && values.cron.trim() ? values.cron.trim() : DEFAULT_CRON
  const timezone =
    typeof values.timezone === "string" && values.timezone.trim()
      ? values.timezone.trim()
      : DEFAULT_TIMEZONE
  return { cron, timezone }
}

/**
 * Reads a cron expression into the editor's form: the simplest mode that
 * says exactly the same thing, or "custom". An expression that doesn't parse
 * is custom too.
 */
export function formFromCron(cron: string): ScheduleForm {
  let fields: string[]
  let weekdays: number[]
  try {
    const parsed = parseCron(cron)
    fields = parsed.fields
    weekdays = parsed.daysOfWeek
  } catch {
    return { ...DEFAULT_FORM, mode: "custom" }
  }
  const [min, hour, dom, month, dow] = fields as [string, string, string, string, string]
  const custom = { ...DEFAULT_FORM, mode: "custom" as const }
  if (month !== "*") return custom

  const minStep = STEP.exec(min)
  if (hour === "*" && dom === "*" && dow === "*") {
    if (min === "*") return { ...DEFAULT_FORM, mode: "minutes", everyMinutes: 1 }
    if (minStep && MINUTE_STEPS.includes(Number(minStep[1])))
      return { ...DEFAULT_FORM, mode: "minutes", everyMinutes: Number(minStep[1]) }
  }
  if (!INT.test(min)) return custom
  const minute = Number(min)

  const hourStep = STEP.exec(hour)
  if (dom === "*" && dow === "*") {
    if (hour === "*") return { ...DEFAULT_FORM, mode: "hourly", minute, everyHours: 1 }
    if (hourStep && HOUR_STEPS.includes(Number(hourStep[1])))
      return { ...DEFAULT_FORM, mode: "hourly", minute, everyHours: Number(hourStep[1]) }
  }
  if (!INT.test(hour)) return custom
  const at = { minute, hour: Number(hour) }

  if (dom === "*" && dow === "*") return { ...DEFAULT_FORM, ...at, mode: "daily" }
  if (dom === "*") return { ...DEFAULT_FORM, ...at, mode: "weekly", weekdays }
  if (dow === "*" && INT.test(dom))
    return { ...DEFAULT_FORM, ...at, mode: "monthly", dayOfMonth: Number(dom) }
  return custom
}

/** Compresses sorted weekdays into cron: [1,2,3,4,5] → "1-5", [1,3,5] → "1,3,5". */
function weekdayField(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.length === 0 || sorted.length === 7) return "*"
  const parts: string[] = []
  let start = sorted[0]!
  let prev = start
  for (const d of [...sorted.slice(1), Number.NaN]) {
    if (d === prev + 1) {
      prev = d
      continue
    }
    parts.push(
      prev - start >= 2 ? `${start}-${prev}` : start === prev ? `${start}` : `${start},${prev}`,
    )
    start = d
    prev = d
  }
  return parts.join(",")
}

/** The cron expression a (non-custom) form describes. */
export function cronFromForm(form: ScheduleForm): string {
  const { minute, hour } = form
  switch (form.mode) {
    case "minutes":
      return form.everyMinutes <= 1 ? "* * * * *" : `*/${form.everyMinutes} * * * *`
    case "hourly":
      return form.everyHours <= 1 ? `${minute} * * * *` : `${minute} */${form.everyHours} * * *`
    case "daily":
      return `${minute} ${hour} * * *`
    case "weekly":
      return `${minute} ${hour} * * ${weekdayField(form.weekdays)}`
    case "monthly":
      return `${minute} ${hour} ${form.dayOfMonth} * *`
    case "custom":
      throw new Error("a custom schedule is edited as cron text")
  }
}

/** The node with its cron and/or time zone changed. */
export function setScheduleValues(
  wf: WorkflowFile,
  nodeId: string,
  patch: { cron?: string; timezone?: string },
): WorkflowFile {
  const node = wf.nodes[nodeId]
  if (!node) return wf
  const values = { ...(node.values ?? {}), ...patch }
  return { ...wf, nodes: { ...wf.nodes, [nodeId]: { ...node, values } } }
}

/** "09:00" for an <input type="time">. */
export function timeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

/** Every IANA time zone this browser knows, UTC first. */
export function timeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  const zones = intl.supportedValuesOf?.("timeZone") ?? []
  return ["UTC", ...zones.filter((z) => z !== "UTC")]
}

/** The viewer's own time zone, e.g. "America/New_York". */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

/** "Thu, Oct 2, 9:00 AM" in the schedule's own time zone. */
export function formatRun(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

/** "in 5 min", "in 3 h", "in 2 days". */
export function formatFromNow(date: Date, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((date.getTime() - now) / 60_000))
  if (minutes < 1) return "in under a minute"
  if (minutes < 60) return `in ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `in ${hours} h`
  return `in ${Math.round(hours / 24)} days`
}
