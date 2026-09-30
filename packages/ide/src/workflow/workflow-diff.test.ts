import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { summarize } from "@/panels/source-control/summaries"
import { diffWorkflows, revertChange } from "./workflow-diff"

// The board's example: SaveUser's role changes, SendWelcome is added, LegacyAudit removed.
const before: WorkflowFile = {
  lorien: 1,
  nodes: {
    Request: { uses: "@core/http-request", values: { path: "/users", method: "POST" } },
    SaveUser: {
      uses: "./nodes/save-user",
      in: { email: "Request.body.email" },
      values: { role: "member" },
    },
    LegacyAudit: { uses: "./nodes/legacy-audit", in: { user: "SaveUser.user" } },
    Response: { uses: "@core/response", in: { body: "SaveUser.user" } },
  },
  view: { Request: { x: 0, y: 0 }, SaveUser: { x: 300, y: 0 }, Response: { x: 600, y: 0 } },
}
const after: WorkflowFile = {
  lorien: 1,
  nodes: {
    Request: { uses: "@core/http-request", values: { path: "/users", method: "POST" } },
    SaveUser: {
      uses: "./nodes/save-user",
      in: { email: "Request.body.email" },
      values: { role: "admin" },
    },
    SendWelcome: { uses: "./nodes/mail/send-welcome", in: { user: "SaveUser.user" } },
    Response: { uses: "@core/response", in: { body: "SaveUser.user" } },
  },
  view: { Request: { x: 0, y: 0 }, SaveUser: { x: 320, y: 0 }, Response: { x: 600, y: 0 } },
}

describe("diffWorkflows", () => {
  const diff = diffWorkflows(before, after)

  it("marks each node", () => {
    expect(diff.nodes).toEqual({
      Request: "same",
      SaveUser: "changed",
      SendWelcome: "added",
      LegacyAudit: "removed",
      Response: "same",
    })
    expect(summarize(diff)).toBe("1 node added, 1 changed, 1 removed")
  })

  it("lists the changes in words", () => {
    expect(diff.changes.map((c) => c.text)).toEqual([
      "Added node SendWelcome ./nodes/mail/send-welcome",
      "Connected SaveUser.user → SendWelcome.user",
      "Removed node LegacyAudit and 1 connection",
      'SaveUser.role changed "member" → "admin"',
    ])
    expect(diff.moved).toEqual(["SaveUser"])
  })

  it("covers rewiring and whole-input references", () => {
    const a: WorkflowFile = { lorien: 1, nodes: { x: { uses: "./x", in: "Request.body" } } }
    const b: WorkflowFile = { lorien: 1, nodes: { x: { uses: "./x", in: "Request.query" } } }
    expect(diffWorkflows(a, b).changes.map((c) => c.text)).toEqual([
      "x now reads Request.query (was Request.body)",
    ])
  })

  it("treats a new file as all added and a deleted one as all removed", () => {
    expect(diffWorkflows(null, after).nodes.Request).toBe("added")
    expect(diffWorkflows(before, null).nodes.Request).toBe("removed")
  })

  it("says so when only the layout moved", () => {
    const moved = { ...before, view: { ...before.view, Request: { x: 10, y: 10 } } }
    expect(summarize(diffWorkflows(before, moved))).toBe("layout only")
  })
})

describe("revertChange", () => {
  const diff = diffWorkflows(before, after)
  const find = (text: string) => diff.changes.find((c) => c.text.startsWith(text))!

  it("undoes a value change", () => {
    const next = revertChange(after, before, find("SaveUser.role"))
    expect(next.nodes.SaveUser?.values).toEqual({ role: "member" })
  })

  it("undoes an added node and the references to it", () => {
    const next = revertChange(after, before, find("Added node SendWelcome"))
    expect(next.nodes.SendWelcome).toBeUndefined()
  })

  it("puts a removed node back where it was", () => {
    const next = revertChange(after, before, find("Removed node LegacyAudit"))
    expect(next.nodes.LegacyAudit).toEqual(before.nodes.LegacyAudit)
  })

  it("undoes a connection", () => {
    const next = revertChange(after, before, find("Connected SaveUser.user"))
    expect(next.nodes.SendWelcome?.in).toBeUndefined()
  })
})
