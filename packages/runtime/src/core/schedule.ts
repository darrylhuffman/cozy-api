import { z } from "zod"
import { defineTrigger } from "../define-trigger.js"

/**
 * Built-in schedule trigger: starts the workflow at the times a cron
 * expression names, in a time zone (UTC unless set). The server that runs
 * the workflows (`lorien dev`, or a built server) keeps the timers; there is
 * no HTTP request, so a Response node's answer goes nowhere.
 */
export default defineTrigger({
  name: "Schedule",
  config: z.object({
    cron: z
      .string()
      .describe("Five-field cron expression: minute hour day-of-month month day-of-week")
      .default("0 9 * * *"),
    timezone: z.string().describe("IANA time zone, e.g. Europe/London").default("UTC"),
  }),
  outputs: z.object({
    /** The time this run was scheduled for, as an ISO string. */
    scheduledAt: z.string(),
    /** The same time in milliseconds since the epoch. */
    timestamp: z.number(),
    /** True when started by hand (the IDE's Run now) rather than by the clock. */
    manual: z.boolean(),
    context: z.object({ runId: z.string() }),
  }),
})
