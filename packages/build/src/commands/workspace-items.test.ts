import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createIdeApp } from "./ide.js"

let root: string

function put(rel: string, content: string | object) {
  const abs = join(root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(
    abs,
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
  )
}

const workflow = (uses: string) => ({
  lorien: 1,
  nodes: { Request: { uses: "@core/http-request" }, AddPet: { uses } },
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lorien-items-"))
  put("workflows/pets/add.workflow", workflow("./nodes/pets/add-pet"))
  put("workflows/pets/add.requests.json", { lorien: 1, requests: [] })
  put("workflows/other.workflow", workflow("./nodes/pets/other"))
  put("nodes/pets/add-pet.ts", "export default {}")
  put("nodes/pets/add-pet.cases.json", { lorien: 1, cases: [] })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function call(method: string, url: string, body?: object) {
  const app = createIdeApp(root)
  const res = await app.request(url, {
    method,
    ...(body && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

describe("workspace rename / delete", () => {
  it("renames a workflow together with its saved requests", async () => {
    const r = await call("POST", "/api/workspace/rename", {
      from: "workflows/pets/add.workflow",
      to: "workflows/pets/create.workflow",
    })
    expect(r.status).toBe(200)
    expect(existsSync(join(root, "workflows/pets/create.workflow"))).toBe(true)
    expect(existsSync(join(root, "workflows/pets/create.requests.json"))).toBe(true)
    expect(existsSync(join(root, "workflows/pets/add.workflow"))).toBe(false)
  })

  it("renames a node with its cases and rewrites the workflows that use it", async () => {
    const r = await call("POST", "/api/workspace/rename", {
      from: "nodes/pets/add-pet.ts",
      to: "nodes/pets/create-pet.ts",
    })
    expect(r.status).toBe(200)
    expect(r.json.updatedWorkflows).toEqual(["workflows/pets/add.workflow"])
    expect(existsSync(join(root, "nodes/pets/create-pet.cases.json"))).toBe(true)
    const wf = JSON.parse(readFileSync(join(root, "workflows/pets/add.workflow"), "utf-8"))
    expect(wf.nodes.AddPet.uses).toBe("./nodes/pets/create-pet")
    const other = JSON.parse(readFileSync(join(root, "workflows/other.workflow"), "utf-8"))
    expect(other.nodes.AddPet.uses).toBe("./nodes/pets/other")
  })

  it("refuses to overwrite, to change the file type, or to leave the workspace", async () => {
    put("nodes/pets/taken.ts", "")
    expect(
      (
        await call("POST", "/api/workspace/rename", {
          from: "nodes/pets/add-pet.ts",
          to: "nodes/pets/taken.ts",
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await call("POST", "/api/workspace/rename", {
          from: "nodes/pets/add-pet.ts",
          to: "workflows/pets/x.workflow",
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await call("POST", "/api/workspace/rename", {
          from: "nodes/pets/add-pet.ts",
          to: "nodes/../../x.ts",
        })
      ).status,
    ).toBe(403)
    expect((await call("DELETE", "/api/workspace/file?path=package.json")).status).toBe(400)
  })

  it("lists the workflows that use a node, and deletes it with its cases", async () => {
    const usage = await call("GET", "/api/workspace/usage?path=nodes/pets/add-pet.ts")
    expect(usage.json.usedBy).toEqual(["workflows/pets/add.workflow"])
    const r = await call("DELETE", "/api/workspace/file?path=nodes/pets/add-pet.ts")
    expect(r.json.deleted).toEqual(["nodes/pets/add-pet.ts", "nodes/pets/add-pet.cases.json"])
    expect(existsSync(join(root, "nodes/pets/add-pet.cases.json"))).toBe(false)
  })

  describe("sub-workflows", () => {
    beforeEach(() => {
      put("nodes/pets/reserve.workflow", {
        lorien: 1,
        nodes: {
          Input: { uses: "@core/input", values: { fields: {} } },
          Add: { uses: "./nodes/pets/add-pet" },
        },
      })
      put("nodes/pets/outer.workflow", workflow("./nodes/pets/reserve"))
      put("workflows/pets/reserve.workflow", workflow("./nodes/pets/reserve"))
    })

    it("lists the workflows and sub-workflows that use a node or a sub-workflow", async () => {
      const node = await call("GET", "/api/workspace/usage?path=nodes/pets/add-pet.ts")
      expect(node.json.usedBy).toEqual([
        "nodes/pets/reserve.workflow",
        "workflows/pets/add.workflow",
      ])
      const sub = await call("GET", "/api/workspace/usage?path=nodes/pets/reserve.workflow")
      expect(sub.json.usedBy).toEqual([
        "nodes/pets/outer.workflow",
        "workflows/pets/reserve.workflow",
      ])
    })

    it("renames a sub-workflow and rewrites everything that uses it", async () => {
      const r = await call("POST", "/api/workspace/rename", {
        from: "nodes/pets/reserve.workflow",
        to: "nodes/pets/hold.workflow",
      })
      expect(r.status).toBe(200)
      expect(r.json.updatedWorkflows).toEqual([
        "nodes/pets/outer.workflow",
        "workflows/pets/reserve.workflow",
      ])
      const wf = JSON.parse(readFileSync(join(root, "workflows/pets/reserve.workflow"), "utf-8"))
      expect(wf.nodes.AddPet.uses).toBe("./nodes/pets/hold")
    })

    it("won't turn a sub-workflow into a TypeScript node", async () => {
      const r = await call("POST", "/api/workspace/rename", {
        from: "nodes/pets/reserve.workflow",
        to: "nodes/pets/reserve.ts",
      })
      expect(r.status).toBe(400)
    })

    it("deletes a sub-workflow", async () => {
      const r = await call("DELETE", "/api/workspace/file?path=nodes/pets/reserve.workflow")
      expect(r.json.deleted).toEqual(["nodes/pets/reserve.workflow"])
    })

    it("shows sub-workflows in the nodes tree", async () => {
      const app = createIdeApp(root)
      const tree = (await (await app.request("/api/workspace/tree")).json()) as {
        nodes: { children: { children: { kind: string; path: string }[] }[] }
      }
      const pets = tree.nodes.children[0]?.children ?? []
      expect(pets.map((c) => `${c.kind}:${c.path}`).sort()).toEqual([
        "node:nodes/pets/add-pet.ts",
        "subworkflow:nodes/pets/outer.workflow",
        "subworkflow:nodes/pets/reserve.workflow",
      ])
    })
  })

  it("deletes a workflow with its saved requests", async () => {
    const r = await call("DELETE", "/api/workspace/file?path=workflows/pets/add.workflow")
    expect(r.status).toBe(200)
    expect(existsSync(join(root, "workflows/pets/add.requests.json"))).toBe(false)
  })
})
