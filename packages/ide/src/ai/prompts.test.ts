import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import type { RunRecord } from "@/store/debug-session"
import {
  CONTEXT_MARKER,
  explainNode,
  fixFailedRun,
  fixFailingCase,
  fixProblems,
  freeform,
  generateCases,
  generateRequests,
  renderPrompt,
  splitPrompt,
} from "./prompts"

const wf = {
  lorien: 1,
  nodes: {
    req: { uses: "@lorien/http-request" },
    save: { uses: "./nodes/user/save-user", inputs: { email: "{{req.body.email}}" } },
  },
} as unknown as WorkflowFile

const schema = {
  name: "saveUser",
  inputs: { type: "object" },
  outputs: { type: "object" },
} as never

describe("renderPrompt / splitPrompt", () => {
  it("round-trips the headline and context", () => {
    const text = renderPrompt({ title: "t", headline: "Do it", context: ["a", "b"] })
    expect(text).toBe(`Do it${CONTEXT_MARKER}a\n\nb`)
    expect(splitPrompt(text)).toEqual({ headline: "Do it", context: "a\n\nb" })
  })

  it("sends just the headline when there is no context", () => {
    const text = renderPrompt({ title: "t", headline: "Hi", context: [] })
    expect(text).toBe("Hi")
    expect(splitPrompt(text)).toEqual({ headline: "Hi", context: null })
  })
})

describe("prompt builders", () => {
  it("explainNode names the node file and asks for no edits", () => {
    const r = explainNode({
      workflowPath: "workflows/u.workflow",
      workflow: wf,
      nodeId: "save",
      uses: "./nodes/user/save-user",
      schema,
    })
    expect(r.title).toBe("Explain save")
    expect(r.headline).toMatch(/Don't change any files/)
    expect(r.context[0]).toBe("Node source: nodes/user/save-user.ts")
    expect(r.context.join("\n")).toContain("Schemas for ./nodes/user/save-user")
  })

  it("generateCases points at the cases file and includes the format", () => {
    const r = generateCases({ uses: "./nodes/user/save-user", schema, existing: [] })
    expect(r.headline).toContain("nodes/user/save-user.cases.json")
    expect(r.headline).toContain("lorien test nodes/user/save-user.cases.json")
    expect(r.context).toContain("nodes/user/save-user.cases.json does not exist yet.")
    expect(r.context.at(-1)).toMatch(/"lorien": 1, "cases"/)
  })

  it("generateCases carries existing cases", () => {
    const existing = [{ id: "a", name: "A", input: {}, expect: {} }]
    const r = generateCases({ uses: "./nodes/user/save-user", schema, existing })
    expect(r.context.join("\n")).toContain("Existing cases in nodes/user/save-user.cases.json")
  })

  it("fixFailingCase includes the case and its failures", () => {
    const r = fixFailingCase({
      uses: "./nodes/user/save-user",
      testCase: { id: "a", name: "saves", input: {}, expect: { output: { id: 1 } } },
      result: {
        caseId: "a",
        name: "saves",
        passed: false,
        failures: ["expected output to contain"],
        durationMs: 3,
      },
    })
    expect(r.title).toBe('Fix "saves"')
    expect(r.context.join("\n")).toContain("expected output to contain")
  })

  it("generateRequests only includes schemas the workflow uses", () => {
    const r = generateRequests({
      workflowPath: "workflows/user/create.workflow",
      workflow: wf,
      existing: [],
      schemas: { "./nodes/user/save-user": schema, "./nodes/other": schema },
    })
    const ctx = r.context.join("\n")
    expect(r.headline).toContain("workflows/user/create.requests.json")
    expect(ctx).toContain("./nodes/user/save-user")
    expect(ctx).not.toContain("./nodes/other")
  })

  it("fixFailedRun returns null unless the run errored", () => {
    const base = {
      runId: "r",
      workflowPath: "workflows/u.workflow",
      triggerNodeId: "req",
      request: { method: "POST", path: "/u" },
      startedAt: 0,
      events: [],
      logs: [],
      pausedFrame: null,
    }
    expect(
      fixFailedRun({
        run: { ...base, outcome: { kind: "ok", status: 200, body: {}, totalMs: 1 } } as RunRecord,
        workflow: wf,
      }),
    ).toBeNull()
    const r = fixFailedRun({
      run: {
        ...base,
        events: [
          { offsetMs: 1, event: { type: "before-node", nodeId: "save", input: { email: "x" } } },
        ],
        logs: [{ offsetMs: 2, level: "error", message: "boom" }],
        outcome: { kind: "errored", nodeId: "save", message: "db down" },
      } as unknown as RunRecord,
      workflow: wf,
    })
    expect(r?.title).toBe("Fix save failure")
    expect(r?.headline).toContain("db down")
    expect(r?.headline).toContain("nodes/user/save-user.ts")
    const ctx = r?.context.join("\n") ?? ""
    expect(ctx).toContain("Input to save")
    expect(ctx).toContain("[error] boom")
  })

  it("fixProblems lists every diagnostic", () => {
    const r = fixProblems({
      workflowPath: "workflows/u.workflow",
      workflow: wf,
      diagnostics: [
        { severity: "error", nodeId: "save", message: "missing input email" },
        { severity: "warning", message: "unused node" },
      ] as never,
    })
    expect(r.headline).toContain("2 problems")
    expect(r.context[0]).toContain("- [error] save: missing input email")
    expect(r.context[0]).toContain("- [warning] unused node")
  })

  it("freeform attaches the selected node when there is one", () => {
    const r = freeform({
      ask: "Add an email step",
      workflowPath: "workflows/u.workflow",
      workflow: wf,
      selected: { nodeId: "save", uses: "./nodes/user/save-user", schema: undefined },
    })
    expect(r.headline).toBe("Add an email step")
    expect(r.context[0]).toBe("Selected node: save (nodes/user/save-user.ts)")
    expect(
      freeform({ ask: "x", workflowPath: null, workflow: null, selected: null }).context,
    ).toEqual([])
  })
})
