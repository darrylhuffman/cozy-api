import { type CronSchedule, nextCronTime, parseCron } from "./cron.js"

/**
 * Keeps running a job on its cron schedule. Like cron.ts this imports
 * nothing outside this folder: `lorien build` copies it into built servers.
 */

export interface ScheduledJob {
  /** Five-field cron expression. */
  cron: string
  /** IANA time zone the cron's times are in. Default UTC. */
  timeZone?: string
  /** Called at each scheduled time with that time. */
  run: (scheduledAt: Date) => unknown
}

export interface ScheduleOptions {
  /** A run threw or rejected. Default: logged with console.error. */
  onError?: (err: unknown, scheduledAt: Date) => void
  /** A run came due while the previous one was still going, so it was skipped. */
  onSkip?: (scheduledAt: Date) => void
  /** For tests. */
  now?: () => number
}

export interface ScheduleHandle {
  /** When the job runs next, or null once stopped (or if it never runs again). */
  next(): Date | null
  stop(): void
}

/** setTimeout's ceiling (about 24.8 days); longer waits re-arm. */
const MAX_DELAY = 2 ** 31 - 1

/**
 * Starts running `job` at each time its cron expression names, until
 * stopped. A run that comes due while the previous one is still going is
 * skipped rather than stacked. Timers don't keep the process alive by
 * themselves; a server does that.
 */
export function startSchedule(job: ScheduledJob, opts: ScheduleOptions = {}): ScheduleHandle {
  const schedule: CronSchedule = parseCron(job.cron)
  const timeZone = job.timeZone || "UTC"
  const now = opts.now ?? Date.now
  const onError =
    opts.onError ??
    ((err: unknown, at: Date) =>
      console.error(`[lorien] scheduled run for ${at.toISOString()} failed:`, err))
  let timer: ReturnType<typeof setTimeout> | undefined
  let nextAt: Date | null = null
  let stopped = false
  let running = false

  const wait = () => {
    if (stopped || !nextAt) return
    const delay = Math.min(Math.max(nextAt.getTime() - now(), 0), MAX_DELAY)
    timer = setTimeout(() => {
      if (nextAt && now() < nextAt.getTime()) wait()
      else fire()
    }, delay)
    ;(timer as { unref?: () => void }).unref?.()
  }

  const arm = (after: number) => {
    nextAt = nextCronTime(schedule, new Date(after), timeZone)
    wait()
  }

  const fire = () => {
    const at = nextAt!
    // After a sleep or a slow event loop, carry on from now: one late run, not a burst.
    arm(Math.max(at.getTime(), now()))
    if (running) {
      opts.onSkip?.(at)
      return
    }
    running = true
    Promise.resolve()
      .then(() => job.run(at))
      .catch((err: unknown) => onError(err, at))
      .finally(() => {
        running = false
      })
  }

  arm(now())
  return {
    next: () => (stopped ? null : nextAt),
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
