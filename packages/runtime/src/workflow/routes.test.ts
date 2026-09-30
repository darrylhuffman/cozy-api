import { describe, expect, it, vi } from "vitest"
import { Hono } from "hono"
import { mountWorkflows } from "../dev-server/server.js"
import { parseWorkflow } from "./parse.js"
import { defaultRoutePath, findRouteConflicts, workflowRoutes } from "./routes.js"

const route = (path: string | undefined, body: string) =>
  parseWorkflow({
    lorien: 1,
    nodes: {
      Request: { uses: "@core/http-request", values: path ? { path } : {} },
      Response: { uses: "@core/response", values: { body } },
    },
  })

describe("routes", () => {
  it("defaults the path to the workflow's folder, like the IDE", () => {
    expect(defaultRoutePath("workflows/users/create.workflow")).toBe("/users")
    expect(defaultRoutePath("workflows/health.workflow")).toBe("/health")
    expect(defaultRoutePath("workflows/admin/users/delete.workflow")).toBe("/admin/users")
    expect(workflowRoutes(route(undefined, "x"), "workflows/rooms/list.workflow")).toEqual([
      { nodeId: "Request", method: "GET", path: "/rooms" },
    ])
  })

  it("finds routes served twice, param names aside", () => {
    const conflicts = findRouteConflicts([
      { relativePath: "workflows/rooms/get.workflow", file: route("/rooms/:id", "a") },
      { relativePath: "workflows/probe.workflow", file: route("/rooms/:roomId", "b") },
      { relativePath: "workflows/rooms/list.workflow", file: route("/rooms", "c") },
    ])
    expect(conflicts).toEqual([
      {
        method: "GET",
        path: "/rooms/:id",
        sources: ["workflows/rooms/get.workflow#Request", "workflows/probe.workflow#Request"],
      },
    ])
  })

  it("doesn't mount either side of a clash in the dev server", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const app = new Hono()
    mountWorkflows(
      app,
      [
        { relativePath: "workflows/rooms/list.workflow", file: route("/rooms", "list") },
        { relativePath: "workflows/probe.workflow", file: route("/rooms", "shadowed!") },
      ],
      { nodes: {}, services: {} },
    )
    expect((await app.request("/rooms")).status).toBe(404)
    expect(error.mock.calls[0]?.[0]).toMatch(/GET \/rooms is served by more than one workflow/)
    error.mockRestore()
  })
})
