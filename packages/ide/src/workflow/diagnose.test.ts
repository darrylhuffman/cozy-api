import { describe, expect, it } from "vitest"
import type { NodeSchemas, WorkflowFile } from "@/lib/api"
import { diagnoseWorkflow, diagnosticsByNode, isValidNodeId } from "./diagnose"

const schemas: Record<string, NodeSchemas> = {
  "@core/schedule": {
    inputs: { type: "object", properties: { cron: { type: "string", default: "0 9 * * *" } } },
    outputs: { type: "object", properties: { scheduledAt: { type: "string" } } },
  },
  "@core/http-request": {
    inputs: {
      type: "object",
      properties: { method: { type: "string", default: "GET" }, path: { type: "string" } },
      required: ["method"],
    },
    outputs: {
      type: "object",
      properties: { body: { type: "object" }, params: { type: "object" } },
    },
  },
  "@core/response": {
    inputs: {
      type: "object",
      properties: { status: { type: "number", default: 200 }, body: {} },
      required: ["status"],
    },
    outputs: { type: "object", properties: {} },
  },
  "./nodes/save-user": {
    inputs: {
      type: "object",
      properties: { email: { type: "string" }, password: { type: "string" } },
      required: ["email", "password"],
    },
    outputs: {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: { id: { type: "string" }, email: { type: "string" } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
}

const good: WorkflowFile = {
  lorien: 1,
  nodes: {
    request: { uses: "@core/http-request", values: { path: "/users" } },
    save: {
      uses: "./nodes/save-user",
      in: { email: "request.body.email", password: "request.body.password" },
    },
    response: { uses: "@core/response", in: { body: "save.user" } },
  },
}

const run = (wf: WorkflowFile, loaded = true) =>
  diagnoseWorkflow(wf, schemas, { schemasLoaded: loaded })
const messages = (wf: WorkflowFile, loaded = true) => run(wf, loaded).map((d) => d.message)

describe("diagnoseWorkflow", () => {
  it("reports nothing for a healthy workflow (opaque request.body paths are fine)", () => {
    expect(run(good)).toEqual([])
  })

  it("flags node ids that can't be referenced", () => {
    const wf: WorkflowFile = {
      ...good,
      nodes: {
        ...good.nodes,
        "save-user": { uses: "./nodes/save-user", values: { email: "a", password: "b" } },
      },
    }
    const d = run(wf).find((x) => x.nodeId === "save-user" && x.field === "id")
    expect(d?.severity).toBe("error")
    expect(isValidNodeId("save-user")).toBe(false)
    expect(isValidNodeId("saveUser2")).toBe(true)
  })

  it("flags unknown node types and missing node files once schemas have loaded", () => {
    const wf: WorkflowFile = {
      ...good,
      nodes: { ...good.nodes, x: { uses: "./nodes/gone" }, y: { uses: "@core/nope" } },
    }
    expect(messages(wf)).toEqual(
      expect.arrayContaining([
        'Node file for "./nodes/gone" is missing or failed to load.',
        'Unknown node type "@core/nope".',
      ]),
    )
    expect(messages(wf, false)).toEqual([])
  })

  it("flags references to unknown nodes, self references and malformed references", () => {
    const wf: WorkflowFile = {
      lorien: 1,
      nodes: {
        request: { uses: "@core/http-request" },
        save: {
          uses: "./nodes/save-user",
          in: { email: "ghost.email", password: "save.user" },
        },
        response: { uses: "@core/response", in: "request.body.bad field" },
      },
    }
    const m = messages(wf)
    expect(m).toContain('Input "email" references unknown node "ghost".')
    expect(m).toContain('Input "password" references its own node.')
    expect(m).toContain(
      '"request.body.bad field" is not a valid reference (segments must be identifiers).',
    )
  })

  it("accepts a dashed field, like a header name", () => {
    const wf: WorkflowFile = {
      ...good,
      nodes: {
        ...good.nodes,
        response: { uses: "@core/response", in: { body: "request.body.x-api-key" } },
      },
    }
    expect(messages(wf).filter((m) => m.includes("x-api-key"))).toEqual([])
  })

  it("warns when a reference names an output the source schema rules out", () => {
    const wf: WorkflowFile = {
      ...good,
      nodes: {
        ...good.nodes,
        response: { uses: "@core/response", in: { body: "save.user.emial" } },
      },
    }
    const d = run(wf).find((x) => x.nodeId === "response")
    expect(d?.severity).toBe("warning")
    expect(d?.message).toBe('"save.user.emial": "emial" is not an output of save.user.')
  })

  it("errors on required inputs nothing provides, honouring values and defaults", () => {
    const wf: WorkflowFile = {
      ...good,
      nodes: {
        ...good.nodes,
        save: { uses: "./nodes/save-user", in: { email: "request.body.email" } },
      },
    }
    const d = run(wf).filter((x) => x.nodeId === "save")
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ severity: "error", field: "password" })

    const withValue: WorkflowFile = {
      ...good,
      nodes: {
        ...good.nodes,
        save: {
          uses: "./nodes/save-user",
          in: { email: "request.body.email" },
          values: { password: "x" },
        },
      },
    }
    expect(run(withValue)).toEqual([])
  })

  it("skips required-input checks for the whole-object `in` form", () => {
    const wf: WorkflowFile = {
      ...good,
      nodes: { ...good.nodes, save: { uses: "./nodes/save-user", in: "request.body" } },
    }
    expect(run(wf)).toEqual([])
  })

  it("flags unknown `after` targets", () => {
    const wf: WorkflowFile = {
      ...good,
      nodes: { ...good.nodes, response: { ...good.nodes.response!, after: ["nobody"] } },
    }
    expect(messages(wf)).toContain('"after" lists unknown node "nobody".')
  })

  it("checks `when` like an input reference", () => {
    const withWhen = (when: string): WorkflowFile => ({
      ...good,
      nodes: { ...good.nodes, response: { ...good.nodes.response!, when } },
    })
    expect(messages(withWhen("!nobody.found"))).toContain(
      'The condition references unknown node "nobody".',
    )
    expect(messages(withWhen("response.ok"))).toContain("The condition references its own node.")
    expect(run(withWhen("!request.body"))).toEqual([])
  })

  it("detects cycles", () => {
    const wf: WorkflowFile = {
      lorien: 1,
      nodes: {
        request: { uses: "@core/http-request" },
        a: { uses: "./nodes/save-user", in: { email: "b.user", password: "request.body" } },
        b: { uses: "./nodes/save-user", in: { email: "a.user", password: "request.body" } },
        response: { uses: "@core/response", in: { body: "b.user" } },
      },
    }
    expect(messages(wf).some((m) => m.startsWith("Cycle: "))).toBe(true)
  })

  it("warns about a missing trigger or a missing response", () => {
    expect(messages({ lorien: 1, nodes: { r: { uses: "@core/response" } } })).toContain(
      "No trigger (HTTP Request or Schedule): nothing starts this workflow.",
    )
    expect(messages({ lorien: 1, nodes: { q: { uses: "@core/http-request" } } })).toContain(
      "No Response node: requests will never get an answer.",
    )
    expect(run({ lorien: 1, nodes: {} })).toEqual([])
  })

  it("checks a schedule's cron and time zone, and wants no Response", () => {
    const sched = (values: Record<string, unknown>): WorkflowFile => ({
      lorien: 1,
      nodes: { Nightly: { uses: "@core/schedule", values } },
    })
    expect(messages(sched({ cron: "0 9 * * 1-5", timezone: "Europe/Paris" }))).toEqual([])
    expect(messages(sched({ cron: "0 25 * * *" }))).toEqual([
      "Schedule: Hour: 25 is out of range (0-23).",
    ])
    expect(messages(sched({ cron: "0 9 * * *", timezone: "Mars/Base" }))).toEqual([
      'Unknown time zone "Mars/Base".',
    ])
  })

  it("groups diagnostics by node", () => {
    const wf: WorkflowFile = {
      lorien: 1,
      nodes: { r: { uses: "@core/response", in: { body: "x.y" } } },
    }
    const grouped = diagnosticsByNode(run(wf))
    expect(grouped.get("r")).toHaveLength(1)
    expect(grouped.has("*")).toBe(false)
  })
})
