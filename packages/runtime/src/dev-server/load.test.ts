import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadWorkflowFile, loadWorkspace } from "./load.js"

describe("loadWorkspace", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lorien-load-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("finds .workflow files in workflows/", async () => {
    mkdirSync(join(dir, "workflows", "users"), { recursive: true })
    writeFileSync(
      join(dir, "workflows", "users", "create.workflow"),
      JSON.stringify({
        lorien: 1,
        nodes: {
          req: {
            uses: "@core/http-request",
            values: { path: "/users", method: "POST" },
          },
          res: { uses: "@core/response", in: { body: "req.body" } },
        },
      }),
    )
    const ws = await loadWorkspace(dir)
    expect(ws.workflows).toHaveLength(1)
    expect(ws.workflows[0]?.relativePath).toBe("workflows/users/create.workflow")
    expect(ws.workflows[0]?.file.nodes.req?.uses).toBe("@core/http-request")
  })

  it("returns empty arrays when directories are missing", async () => {
    const ws = await loadWorkspace(dir)
    expect(ws.workflows).toEqual([])
    expect(ws.nodes).toEqual({})
  })

  it("collects errors instead of throwing on a malformed .workflow file", async () => {
    mkdirSync(join(dir, "workflows"), { recursive: true })
    writeFileSync(join(dir, "workflows", "bad.workflow"), "{not valid json")
    const ws = await loadWorkspace(dir)
    expect(ws.workflows).toEqual([])
    expect(ws.errors).toHaveLength(1)
    expect(ws.errors[0]?.message).toMatch(/JSON|Invalid/i)
  })

  it("relativePath is workspace-root-relative (includes 'workflows/' prefix) for nested dirs", async () => {
    mkdirSync(join(dir, "workflows", "billing", "subscriptions"), { recursive: true })
    writeFileSync(
      join(dir, "workflows", "billing", "subscriptions", "cancel.workflow"),
      JSON.stringify({
        lorien: 1,
        nodes: {
          req: { uses: "@core/http-request", values: { path: "/cancel", method: "POST" } },
          res: { uses: "@core/response", in: { body: "req.body" } },
        },
      }),
    )
    const ws = await loadWorkspace(dir)
    expect(ws.workflows[0]?.relativePath).toBe("workflows/billing/subscriptions/cancel.workflow")
  })
  describe("sub-workflows", () => {
    const write = (rel: string, json: unknown) => {
      const abs = join(dir, rel)
      mkdirSync(join(abs, ".."), { recursive: true })
      writeFileSync(abs, typeof json === "string" ? json : JSON.stringify(json))
    }
    const greet = {
      lorien: 1,
      label: "Greet",
      nodes: {
        Input: { uses: "@core/input", values: { fields: { name: "string" } } },
        Output: { uses: "@core/output", in: { name: "Input.name" } },
      },
    }
    const route = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request", values: { path: "/hi", method: "GET" } },
        Greet: { uses: "./nodes/people/greet", in: { name: "Request.query.name" } },
        Response: { uses: "@core/response", in: { body: "Greet.name" } },
      },
    }

    it("loads .workflow files under nodes/ and flattens the routes that use them", async () => {
      write("nodes/people/greet.workflow", greet)
      write("workflows/hi.workflow", route)
      const ws = await loadWorkspace(dir)
      expect(ws.errors).toEqual([])
      expect(Object.keys(ws.subworkflows)).toEqual(["./nodes/people/greet"])
      expect(ws.subworkflows["./nodes/people/greet"]?.relativePath).toBe(
        "nodes/people/greet.workflow",
      )
      const [wf] = ws.workflows
      expect(wf?.source?.nodes.Greet?.uses).toBe("./nodes/people/greet")
      expect(wf?.file.nodes.Response?.in).toEqual({ body: "Greet__Output.name" })
      expect(await loadWorkflowFile(dir, "hi")).toEqual(wf?.file)
    })

    it("keeps `source` off workflows that use no sub-workflow", async () => {
      write("workflows/hi.workflow", { ...route, nodes: { Request: route.nodes.Request } })
      const [wf] = (await loadWorkspace(dir)).workflows
      expect(wf?.source).toBeUndefined()
    })

    it("reports a sub-workflow that shares its name with a TypeScript node", async () => {
      write("nodes/people/greet.workflow", greet)
      write("nodes/people/greet.ts", "export default {}")
      const ws = await loadWorkspace(dir)
      expect(ws.subworkflows).toEqual({})
      expect(ws.errors[0]?.message).toMatch(
        /is both a sub-workflow and nodes[\\/]people[\\/]greet\.ts/,
      )
    })

    it("reports a route whose sub-workflow node can't be flattened, naming the node", async () => {
      write("nodes/people/greet.workflow", greet)
      write("workflows/hi.workflow", {
        ...route,
        nodes: {
          ...route.nodes,
          Greet: { uses: "./nodes/people/greet", in: { nme: "Request.query.name" } },
        },
      })
      const ws = await loadWorkspace(dir)
      expect(ws.workflows).toEqual([])
      expect(ws.errors[0]?.message).toMatch(/^Greet\.in\.nme: .*no input `nme`/)
    })
  })
})
