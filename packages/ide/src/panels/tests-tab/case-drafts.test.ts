import { describe, expect, it } from "vitest"
import type { RunRecord } from "@/store/debug-session"
import { caseFromDraft, draftFromCase, draftFromRun, lastRunOf, newDraft } from "./case-drafts"

const wf = {
  lorien: 1 as const,
  nodes: { Request: { uses: "@core/http-request" }, SaveUser: { uses: "./nodes/user/save-user" } },
}

function run(
  events: RunRecord["events"],
  workflowPath = "workflows/user/create.workflow",
): RunRecord {
  return {
    runId: "r",
    workflowPath,
    triggerNodeId: "Request",
    request: { method: "POST", path: "/users" },
    startedAt: 0,
    events,
    logs: [],
    pausedFrame: null,
    outcome: { kind: "running" },
  }
}

describe("case drafts", () => {
  it("round-trips a case through the editor's text form", () => {
    for (const c of [
      { id: "a", name: "A", input: { x: 1 }, expect: { output: { y: 2 } } },
      { id: "b", name: "B", input: {}, expect: { output: [1], match: "equals" as const } },
      {
        id: "c",
        name: "C",
        input: {},
        mocks: { db: { get: { throws: "x" } } },
        expect: { error: "x" },
      },
      { id: "d", name: "D", input: {}, expect: {} },
    ]) {
      expect(caseFromDraft(draftFromCase(c)).case).toEqual(c)
    }
  })

  it("explains bad JSON and missing names", () => {
    const d = newDraft("n", undefined)
    expect(caseFromDraft(d).error).toBe("Give the case a name.")
    expect(caseFromDraft({ ...d, name: "x", input: "{" }).error).toMatch(/^Input is not valid JSON/)
    expect(caseFromDraft({ ...d, name: "x", input: "[]" }).error).toBe(
      "Input must be a JSON object.",
    )
    expect(caseFromDraft({ ...d, name: "x", mocks: "nope" }).error).toMatch(
      /^Mocks is not valid JSON/,
    )
  })

  it("prefills new cases from the input schema", () => {
    const d = newDraft("n", {
      type: "object",
      properties: { email: { type: "string" }, age: { type: "number" } },
    })
    expect(Object.keys(JSON.parse(d.input))).toEqual(["email", "age"])
  })
})

describe("lastRunOf", () => {
  it("finds the node's latest input and output in debug runs of this workflow", () => {
    const runs = [
      run([
        {
          offsetMs: 0,
          event: { type: "before-node", nodeId: "SaveUser", input: { email: "a@b.co" } },
        },
        {
          offsetMs: 1,
          event: {
            type: "after-node",
            nodeId: "SaveUser",
            output: { user: { id: "1" } },
            durationMs: 1,
          },
        },
      ]),
    ]
    const found = lastRunOf(runs, wf, "workflows/user/create.workflow", "./nodes/user/save-user")
    expect(found).toEqual({
      nodeId: "SaveUser",
      input: { email: "a@b.co" },
      output: { user: { id: "1" } },
    })
    const draft = draftFromRun("x", found!)
    expect(draft.mode).toBe("equals")
    expect(caseFromDraft(draft).case?.expect).toEqual({
      output: { user: { id: "1" } },
      match: "equals",
    })
  })

  it("turns a failed node into an error case", () => {
    const runs = [
      run([
        { offsetMs: 0, event: { type: "before-node", nodeId: "SaveUser", input: {} } },
        {
          offsetMs: 1,
          event: { type: "error", nodeId: "SaveUser", error: { message: "db down" } },
        },
      ]),
    ]
    const found = lastRunOf(runs, wf, "workflows/user/create.workflow", "./nodes/user/save-user")
    expect(draftFromRun("x", found!)).toMatchObject({ mode: "error", error: "db down" })
  })

  it("ignores other workflows and nodes that never ran", () => {
    const other = run(
      [{ offsetMs: 0, event: { type: "before-node", nodeId: "SaveUser", input: {} } }],
      "workflows/other.workflow",
    )
    expect(
      lastRunOf([other], wf, "workflows/user/create.workflow", "./nodes/user/save-user"),
    ).toBeNull()
    expect(
      lastRunOf([run([])], wf, "workflows/user/create.workflow", "./nodes/user/save-user"),
    ).toBeNull()
  })
})

describe("lastRunOf for a sub-workflow node", () => {
  it("takes what its Input received and its Output handed back", () => {
    const caller = {
      lorien: 1 as const,
      nodes: { Reserve: { uses: "./nodes/orders/reserve" } },
    }
    const frames = (inner: string) => [
      { workflowPath: "workflows/o.workflow", nodeId: "Reserve" },
      { workflowPath: "nodes/orders/reserve.workflow", nodeId: inner },
    ]
    const r = {
      ...run([
        {
          offsetMs: 0,
          event: { type: "before-node", nodeId: "Reserve__Input", input: { id: "e1" } },
        },
        {
          offsetMs: 1,
          event: {
            type: "after-node",
            nodeId: "Reserve__Output",
            output: { ok: true },
            durationMs: 0,
          },
        },
      ]),
      workflowPath: "workflows/o.workflow",
      origins: {
        Reserve__Input: { frames: frames("Input"), role: "input" as const },
        Reserve__Output: { frames: frames("Output"), role: "output" as const },
      },
    }
    expect(lastRunOf([r], caller, "workflows/o.workflow", "./nodes/orders/reserve")).toEqual({
      nodeId: "Reserve",
      input: { id: "e1" },
      output: { ok: true },
    })
  })
})
