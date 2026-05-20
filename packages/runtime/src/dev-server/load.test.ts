import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadWorkspace } from "./load.js"

describe("loadWorkspace", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cozy-load-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("finds .workflow files in workflows/", async () => {
    mkdirSync(join(dir, "workflows", "users"), { recursive: true })
    writeFileSync(
      join(dir, "workflows", "users", "create.workflow"),
      JSON.stringify({
        cozy: 1,
        nodes: {
          req: { uses: "@core/http-request", config: { path: "/users", method: "POST" } },
          res: { uses: "@core/response", in: { body: "req.body" } },
        },
      }),
    )
    const ws = await loadWorkspace(dir)
    expect(ws.workflows).toHaveLength(1)
    expect(ws.workflows[0]?.relativePath).toBe("users/create.workflow")
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
})
