import {
  cronProblem,
  describeCron,
  isValidTimeZone,
  nextCronTimes,
} from "@darrylondil/lorien-runtime/schedule"
import { CalendarClock, Play } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { NodeInstance } from "@/lib/api"
import { restBase } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useDebugSessionStore } from "@/store/debug-session"
import { isDraftDirty, useWorkflowDrafts } from "@/store/workflow-drafts"
import {
  cronFromForm,
  formatFromNow,
  formatRun,
  formFromCron,
  HOUR_STEPS,
  localTimeZone,
  MINUTE_STEPS,
  MODES,
  type ScheduleForm,
  type ScheduleMode,
  scheduleValues,
  setScheduleValues,
  timeValue,
  timeZones,
} from "./schedule"

const RUN_SCHEDULE_PATH = "/__lorien/schedules/run"
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
/** Weekday chips start on Monday. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const UPCOMING = 5

const LABEL = "text-[11px] text-muted-foreground"
const FIELD =
  "h-8 rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 aria-[invalid]:border-destructive"
const CHIP =
  "flex h-7 items-center justify-center rounded-md text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
const CHIP_ON = "bg-primary/15 font-medium text-primary ring-1 ring-primary/40"
const CHIP_OFF = "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground"

/**
 * The inspector's editor for an `@core/schedule` node: pick how often it
 * runs from plain choices (or write cron by hand), its time zone, and see
 * the next few runs. Writes `values.cron` and `values.timezone`.
 */
export function ScheduleEditor({
  nodeId,
  instance,
  tabId,
  workflowPath,
}: {
  nodeId: string
  instance: NodeInstance
  tabId: string | null
  workflowPath: string
}) {
  const { cron, timezone } = scheduleValues(instance)
  const parsed = useMemo(() => formFromCron(cron), [cron])
  // A mode picked that the cron alone wouldn't show (Custom for a daily cron,
  // Weekly with every day ticked). Forgotten once the cron changes elsewhere.
  const [picked, setPicked] = useState<{ mode: ScheduleMode; cron: string } | null>(null)
  const mode = picked?.cron === cron ? picked.mode : parsed.mode
  const form: ScheduleForm = { ...parsed, mode }
  const cronIssue = cronProblem(cron)
  const disabled = !tabId

  const write = (patch: { cron?: string; timezone?: string }) => {
    if (!tabId) return
    const drafts = useWorkflowDrafts.getState()
    const draft = drafts.drafts[tabId]
    if (!draft) return
    drafts.apply(tabId, setScheduleValues(draft.workflow, nodeId, patch), {
      coalesceKey: `schedule:${nodeId}:${Object.keys(patch).join(",")}`,
    })
  }

  const writeCron = (next: string, as: ScheduleMode) => {
    setPicked(formFromCron(next).mode === as ? null : { mode: as, cron: next })
    if (next !== cron) write({ cron: next })
  }

  const update = (patch: Partial<ScheduleForm>) => {
    const next = { ...form, ...patch }
    writeCron(cronFromForm(next), next.mode)
  }

  const pickMode = (m: ScheduleMode) => {
    if (m === mode) return
    if (m === "custom") setPicked({ mode: "custom", cron })
    else writeCron(cronFromForm({ ...form, mode: m }), m)
  }

  return (
    <div className="flex flex-col gap-3" data-testid="schedule-editor">
      <Summary cron={cron} timezone={timezone} problem={cronIssue} />

      <fieldset
        className="grid grid-cols-3 gap-0.5 rounded-md bg-muted/50 p-0.5"
        disabled={disabled}
      >
        <legend className="sr-only">Repeat</legend>
        {MODES.map(({ mode: m, label }) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => pickMode(m)}
            className={cn(
              "h-7 rounded-[5px] text-xs",
              mode === m
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </fieldset>

      {mode === "minutes" && (
        <Row label="Every">
          <Chips
            label="Minutes between runs"
            options={MINUTE_STEPS}
            value={form.everyMinutes}
            onPick={(everyMinutes) => update({ everyMinutes })}
            disabled={disabled}
            suffix="min"
          />
        </Row>
      )}

      {mode === "hourly" && (
        <>
          <Row label="Every">
            <Chips
              label="Hours between runs"
              options={HOUR_STEPS}
              value={form.everyHours}
              onPick={(everyHours) => update({ everyHours })}
              disabled={disabled}
              suffix="h"
            />
          </Row>
          <Row label="At minute">
            <MinuteField
              value={form.minute}
              onChange={(minute) => update({ minute })}
              disabled={disabled}
            />
          </Row>
        </>
      )}

      {mode === "weekly" && (
        <Row label="On">
          <WeekdayPicker
            days={form.weekdays}
            onChange={(weekdays) => update({ weekdays })}
            disabled={disabled}
          />
        </Row>
      )}

      {mode === "monthly" && (
        <Row label="On day">
          <MonthDayPicker
            day={form.dayOfMonth}
            onPick={(dayOfMonth) => update({ dayOfMonth })}
            disabled={disabled}
          />
        </Row>
      )}

      {(mode === "daily" || mode === "weekly" || mode === "monthly") && (
        <Row label="At">
          <input
            type="time"
            aria-label="Time of day"
            step={60}
            required
            value={timeValue(form.hour, form.minute)}
            disabled={disabled}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number)
              if (Number.isInteger(h) && Number.isInteger(m)) update({ hour: h!, minute: m! })
            }}
            className={cn(FIELD, "w-[7.5rem] tabular-nums")}
          />
        </Row>
      )}

      {mode === "custom" && (
        <CronField
          key={cron}
          cron={cron}
          disabled={disabled}
          onCommit={(next) => writeCron(next, "custom")}
        />
      )}

      <TimeZoneField
        key={timezone}
        timezone={timezone}
        disabled={disabled}
        onCommit={(tz) => write({ timezone: tz })}
      />

      <Upcoming cron={cron} timezone={timezone} />

      <RunNow workflowPath={workflowPath} nodeId={nodeId} tabId={tabId} />
    </div>
  )
}

function Summary({
  cron,
  timezone,
  problem,
}: {
  cron: string
  timezone: string
  problem: string | null
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-md bg-muted/40 px-3 py-2.5">
      <CalendarClock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span data-testid="schedule-summary" className="font-medium text-[13px] text-foreground">
          {problem ? "Not a valid schedule" : describeCron(cron)}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {cron} · {timezone}
        </span>
        {problem && (
          <span role="alert" className="text-xs text-destructive">
            {problem}
          </span>
        )}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL}>{label}</span>
      {children}
    </div>
  )
}

function Chips({
  label,
  options,
  value,
  onPick,
  disabled,
  suffix,
}: {
  label: string
  options: number[]
  value: number
  onPick: (n: number) => void
  disabled: boolean
  suffix: string
}) {
  return (
    <fieldset className="grid grid-cols-6 gap-1">
      <legend className="sr-only">{label}</legend>
      {options.map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={n === value}
          aria-label={`${n} ${suffix}`}
          disabled={disabled}
          onClick={() => onPick(n)}
          className={cn(CHIP, n === value ? CHIP_ON : CHIP_OFF)}
        >
          {n}
        </button>
      ))}
    </fieldset>
  )
}

function MinuteField({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (n: number) => void
  disabled: boolean
}) {
  const [text, setText] = useState(String(value).padStart(2, "0"))
  useEffect(() => setText(String(value).padStart(2, "0")), [value])
  const n = Number(text)
  const valid = /^\d{1,2}$/.test(text) && n >= 0 && n <= 59
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[13px] text-muted-foreground">:</span>
      <input
        aria-label="Minute past the hour"
        inputMode="numeric"
        value={text}
        disabled={disabled}
        aria-invalid={valid ? undefined : true}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (/^\d{1,2}$/.test(e.target.value) && v <= 59) onChange(v)
        }}
        onBlur={() => setText(String(value).padStart(2, "0"))}
        className={cn(FIELD, "w-16 text-center font-mono tabular-nums")}
      />
      <span className="text-xs text-muted-foreground">past the hour</span>
    </div>
  )
}

function WeekdayPicker({
  days,
  onChange,
  disabled,
}: {
  days: number[]
  onChange: (days: number[]) => void
  disabled: boolean
}) {
  const set = new Set(days)
  const toggle = (d: number) => {
    const next = new Set(set)
    if (next.has(d)) next.delete(d)
    else next.add(d)
    // A weekly schedule runs on at least one day.
    if (next.size > 0) onChange([...next].sort((a, b) => a - b))
  }
  const presets: Array<[string, number[]]> = [
    ["Weekdays", [1, 2, 3, 4, 5]],
    ["Weekends", [0, 6]],
    ["Every day", [0, 1, 2, 3, 4, 5, 6]],
  ]
  return (
    <div className="flex flex-col gap-1.5">
      <fieldset className="grid grid-cols-7 gap-1">
        <legend className="sr-only">Days of the week</legend>
        {WEEK_ORDER.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={set.has(d)}
            aria-label={DAY_NAMES[d]}
            title={DAY_NAMES[d]}
            disabled={disabled}
            onClick={() => toggle(d)}
            className={cn(CHIP, set.has(d) ? CHIP_ON : CHIP_OFF)}
          >
            {DAY_LETTERS[d]}
          </button>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-1">
        {presets.map(([label, preset]) => {
          const on = preset.length === set.size && preset.every((d) => set.has(d))
          return (
            <button
              key={label}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onChange(preset)}
              className={cn(
                "h-6 rounded-full px-2.5 text-[11px]",
                on ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MonthDayPicker({
  day,
  onPick,
  disabled,
}: {
  day: number
  onPick: (d: number) => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <fieldset className="grid grid-cols-7 gap-1">
        <legend className="sr-only">Day of the month</legend>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={d === day}
            disabled={disabled}
            onClick={() => onPick(d)}
            className={cn(CHIP, "h-6", d === day ? CHIP_ON : CHIP_OFF)}
          >
            {d}
          </button>
        ))}
      </fieldset>
      {day > 28 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Months without a day {day} are skipped.
        </p>
      )}
    </div>
  )
}

const CRON_PARTS = ["minute", "hour", "day", "month", "weekday"]

function CronField({
  cron,
  disabled,
  onCommit,
}: {
  cron: string
  disabled: boolean
  onCommit: (cron: string) => void
}) {
  const [text, setText] = useState(cron)
  const trimmed = text.trim().replace(/\s+/g, " ")
  const issue = trimmed === cron ? null : cronProblem(trimmed)
  const commit = () => {
    if (!issue && trimmed !== cron) onCommit(trimmed)
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label className={cn(LABEL, "flex flex-col gap-1.5")}>
        Cron expression
        <input
          aria-label="Cron expression"
          value={text}
          disabled={disabled}
          spellCheck={false}
          aria-invalid={issue ? true : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
            if (e.key === "Escape") setText(cron)
          }}
          className={cn(FIELD, "w-full font-mono tracking-wide")}
        />
      </label>
      <div className="grid grid-cols-5 gap-1 font-mono text-[10px] text-muted-foreground">
        {CRON_PARTS.map((p) => (
          <span key={p} className="truncate text-center">
            {p}
          </span>
        ))}
      </div>
      {issue ? (
        <span role="alert" className="text-xs text-destructive">
          {issue}
        </span>
      ) : (
        trimmed !== cron && (
          <span className="text-xs text-muted-foreground">
            {describeCron(trimmed)}. Press Enter to apply.
          </span>
        )
      )}
    </div>
  )
}

function TimeZoneField({
  timezone,
  disabled,
  onCommit,
}: {
  timezone: string
  disabled: boolean
  onCommit: (tz: string) => void
}) {
  const [text, setText] = useState(timezone)
  const zones = useMemo(timeZones, [])
  const mine = localTimeZone()
  const trimmed = text.trim()
  const valid = trimmed !== "" && isValidTimeZone(trimmed)
  const commit = (tz: string) => {
    if (tz !== timezone && isValidTimeZone(tz)) onCommit(tz)
  }
  const quick = [...new Set(["UTC", mine])].filter((z) => z !== timezone)
  return (
    <div className="flex flex-col gap-1.5">
      <label className={cn(LABEL, "flex flex-col gap-1.5")}>
        Time zone
        <input
          aria-label="Time zone"
          list="lorien-time-zones"
          value={text}
          disabled={disabled}
          spellCheck={false}
          aria-invalid={valid ? undefined : true}
          onChange={(e) => {
            setText(e.target.value)
            // Picking from the list commits straight away.
            if (zones.includes(e.target.value)) commit(e.target.value)
          }}
          onBlur={() => (valid ? commit(trimmed) : setText(timezone))}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
          }}
          className={cn(FIELD, "w-full")}
        />
      </label>
      <datalist id="lorien-time-zones">
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      {!valid && trimmed !== "" && (
        <span role="alert" className="text-xs text-destructive">
          Unknown time zone
        </span>
      )}
      {quick.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {quick.map((z) => (
            <button
              key={z}
              type="button"
              disabled={disabled}
              onClick={() => commit(z)}
              className="h-6 rounded-full px-2.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Use {z === mine && z !== "UTC" ? `mine (${z})` : z}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Upcoming({ cron, timezone }: { cron: string; timezone: string }) {
  // Re-read the clock each minute so "in 5 min" stays true.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const runs = useMemo(() => {
    if (cronProblem(cron, timezone)) return []
    return nextCronTimes(cron, new Date(now), UPCOMING, timezone)
  }, [cron, timezone, now])
  if (runs.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL}>
        Next runs{timezone !== localTimeZone() ? ` (${timezone} time)` : ""}
      </span>
      <ol className="flex flex-col gap-0.5" data-testid="schedule-upcoming">
        {runs.map((d, i) => (
          <li
            key={d.getTime()}
            className={cn(
              "flex h-[26px] items-center justify-between gap-2 rounded-md px-2 text-xs",
              i === 0 ? "bg-muted/40 text-foreground" : "text-foreground/80",
            )}
          >
            <span className="truncate tabular-nums">{formatRun(d, timezone)}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {formatFromNow(d, now)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function RunNow({
  workflowPath,
  nodeId,
  tabId,
}: {
  workflowPath: string
  nodeId: string
  tabId: string | null
}) {
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "running" } | { kind: "done" } | { kind: "error"; message: string }
  >({ kind: "idle" })
  const dirty = useWorkflowDrafts((s) => (tabId ? isDraftDirty(s.drafts[tabId]) : false))
  const run = async () => {
    setState({ kind: "running" })
    useDebugSessionStore.getState().followNextRuns()
    try {
      const res = await fetch(`${restBase()}${RUN_SCHEDULE_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflowPath, nodeId }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (res.ok && body.ok !== false) setState({ kind: "done" })
      else setState({ kind: "error", message: body.error ?? `HTTP ${res.status}` })
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message })
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void run()}
        disabled={state.kind === "running" || !workflowPath}
        className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-input text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
      >
        <Play aria-hidden className="h-3 w-3" />
        {state.kind === "running" ? "Running…" : "Run now"}
      </button>
      {state.kind === "done" && (
        <span className="text-xs text-success">Ran. The run is in the Debug panel.</span>
      )}
      {state.kind === "error" && (
        <span role="alert" className="text-xs text-destructive">
          {state.message}
        </span>
      )}
      {dirty && state.kind !== "error" && (
        <span className="text-xs text-muted-foreground">Runs the saved version of this file.</span>
      )}
    </div>
  )
}
