import type { NodeOrigins, WireLifecycleEvent } from "@darrylondil/lorien-runtime"
import { describe, expect, it } from "vitest"
import type { RunRecord } from "./debug-session"
import { framesOf, runStatusesIn, samePath } from "./run-origins"

const CALLER = "workflows/orders/create.workflow"
const SUB = "nodes/orders/reserve.workflow"
const inSub = (inner: string) => [
  { workflowPath: CALLER, nodeId: "Reserve" },
  { workflowPath: SUB, nodeId: inner },
]
const origins: NodeOrigins = {
  Reserve__Input: { frames: inSub("Input"), role: "input" },
  Reserve__Find: { frames: inSub("Find") },
  Reserve__Output: { frames: inSub("Output"), role: "output" },
}

function run(events: WireLifecycleEvent[], paused?: string): RunRecord {
  return {
    runId: "r",
    workflowPath: CALLER,
    triggerNodeId: "Request",
    request: { method: "POST", path: "/orders" },
    origins,
    startedAt: 0,
    events: events.map((event, i) => ({ offsetMs: i, event })),
    logs: [],
    pausedFrame: paused ? { nodeId: paused, phase: "before", payload: {} } : null,
    outcome: { kind: "running" },
  }
}

const begin = (nodeId: string): WireLifecycleEvent => ({ type: "before-node", nodeId, input: {} })
const end = (nodeId: string): WireLifecycleEvent => ({
  type: "after-node",
  nodeId,
  output: {},
  durationMs: 0,
})

describe("run origins", () => {
  it("knows where a node was written", () => {
    expect(framesOf(run([]), "Reserve__Find")).toEqual(inSub("Find"))
    expect(framesOf(run([]), "Request")).toEqual([{ workflowPath: CALLER, nodeId: "Request" }])
    expect(samePath("workflows/a.workflow", "workflows/a.workflow")).toBe(true)
    expect(samePath("/abs/workflows/a.workflow", "workflows/a.workflow")).toBe(true)
    expect(samePath("workflows/a.workflow", "workflows/b.workflow")).toBe(false)
  })

  it("shows a sub-workflow node running, then done, in the caller", () => {
    const started = run([begin("Request"), end("Request"), begin("Reserve__Input")])
    expect(runStatusesIn(started, CALLER)).toEqual(
      new Map([
        ["Request", "completed"],
        ["Reserve", "running"],
      ]),
    )
    const done = run([
      begin("Reserve__Input"),
      end("Reserve__Input"),
      begin("Reserve__Find"),
      end("Reserve__Find"),
      begin("Reserve__Output"),
      end("Reserve__Output"),
    ])
    expect(runStatusesIn(done, CALLER).get("Reserve")).toBe("completed")
  })

  it("shows the inner nodes in the sub-workflow's own tab, paused one included", () => {
    const r = run(
      [begin("Request"), end("Request"), begin("Reserve__Input"), end("Reserve__Input")],
      "Reserve__Find",
    )
    expect(runStatusesIn(r, SUB)).toEqual(
      new Map([
        ["Input", "completed"],
        ["Find", "paused"],
      ]),
    )
    // Pausing inside shows on the sub-workflow node in the caller too.
    expect(runStatusesIn(r, CALLER).get("Reserve")).toBe("paused")
    expect(runStatusesIn(r, "workflows/other.workflow").size).toBe(0)
  })

  it("marks the sub-workflow node errored or skipped from inside", () => {
    const failed = run([
      begin("Reserve__Input"),
      { type: "error", nodeId: "Reserve__Find", error: { message: "boom" } },
    ])
    expect(runStatusesIn(failed, CALLER).get("Reserve")).toBe("errored")
    const skipped = run([{ type: "skipped", nodeId: "Reserve__Input" }])
    expect(runStatusesIn(skipped, CALLER).get("Reserve")).toBe("skipped")
  })
})
