import { Hono } from "hono"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { parseWorkflow } from "../workflow/parse.js"
import { validateWorkflow } from "../workflow/validate.js"
import type { LoadedWorkflow } from "./load.js"
import { RUN_SCHEDULE_PATH, startWorkflowSchedules } from "./schedules.js"
import { mountWorkflows } from "./server.js"

const seen: unknown[] = []
const record = defineNode({
  inputs: z.object({ at: z.string(), manual: z.boolean() }),
  outputs: z.object({ ok: z.boolean() }),
  async run(input) {
    seen.push(input)
    return { ok: true }
  },
})

function workflow(nodes: Record<string, unknown>): LoadedWorkflow {
  return {
    absolutePath: "/fake/workflows/nightly.workflow",
    relativePath: "workflows/nightly.workflow",
    file: parseWorkflow({ lorien: 1, nodes }),
  }
}

const nightly = workflow({
  Nightly: { uses: "@core/schedule", values: { cron: "*/30 * * * *", timezone: "UTC" } },
  Record: { uses: "./record", in: { at: "Nightly.scheduledAt", manual: "Nightly.manual" } },
  // Belongs to the HTTP trigger only; a scheduled run must not reach it.
  Request: { uses: "@core/http-request", values: { path: "/nightly", method: "GET" } },
  Respond: { uses: "@core/response", in: { body: "Request.query" } },
})

afterEach(() => {
  seen.length = 0
  vi.useRealTimers()
})

describe("schedules", () => {
  it("run the workflow from the schedule trigger at each time", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-01T10:07:30Z"))
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const running = startWorkflowSchedules([nightly], { nodes: { "./record": record } })
    expect(log).toHaveBeenCalledWith(
      "[lorien] workflows/nightly.workflow#Nightly: Every 30 minutes (UTC), next at 2026-10-01T10:30:00.000Z",
    )
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(seen).toEqual([
      { at: "2026-10-01T10:30:00.000Z", manual: false },
      { at: "2026-10-01T11:00:00.000Z", manual: false },
    ])
    running.stop()
    log.mockRestore()
  })

  it("skip a workflow that doesn't validate", () => {
    const bad = workflow({ Nightly: { uses: "@core/schedule", values: { cron: "every day" } } })
    expect(validateWorkflow(bad.file).errors[0]?.message).toBe(
      "Expected 5 fields (minute hour day-of-month month day-of-week), got 2",
    )
    const running = startWorkflowSchedules([bad], { nodes: {}, log: false })
    expect(running.schedules).toEqual([])
  })

  it("can be run now through the IDE's test hooks", async () => {
    const app = new Hono()
    mountWorkflows(app, [nightly], { nodes: { "./record": record }, testHooks: true })
    const res = await app.request(RUN_SCHEDULE_PATH, {
      method: "POST",
      body: JSON.stringify({ workflowPath: "workflows/nightly.workflow", nodeId: "Nightly" }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 200, body: null })
    expect(seen).toEqual([{ at: expect.any(String), manual: true }])

    const missing = await app.request(RUN_SCHEDULE_PATH, {
      method: "POST",
      body: JSON.stringify({ workflowPath: "workflows/nightly.workflow", nodeId: "Nope" }),
    })
    expect(missing.status).toBe(404)
  })

  it("aren't runnable from a server without test hooks", async () => {
    const app = new Hono()
    mountWorkflows(app, [nightly], { nodes: { "./record": record } })
    const res = await app.request(RUN_SCHEDULE_PATH, { method: "POST", body: "{}" })
    expect(res.status).toBe(404)
  })
})
