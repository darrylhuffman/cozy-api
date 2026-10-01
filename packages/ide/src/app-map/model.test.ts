import { describe, expect, it } from "vitest"
import { petShop } from "./fixture.test-data"
import {
  buildAppMap,
  connectedTo,
  type MiddlewareItem,
  visibleKeys,
  type WorkflowItem,
} from "./model"

const map = buildAppMap(petShop)
const ALL = new Set(["workflow", "node", "middleware", "provider"] as const)

describe("buildAppMap", () => {
  it("derives each route's method and path", () => {
    const routes = map.items
      .filter((i): i is WorkflowItem => i.kind === "workflow")
      .map((w) => `${w.method} ${w.route}`)
    expect(routes.sort()).toEqual(["GET /admin/pets", "GET /hello", "POST /admin/pets"])
  })

  it("connects workflows to nodes and nodes to providers", () => {
    expect(map.edges).toContainEqual({
      source: "workflow:workflows/hello.workflow",
      target: "node:nodes/say-hello.ts",
      type: "uses",
    })
    expect(map.edges).toContainEqual({
      source: "node:nodes/pets/add-pet.ts",
      target: "provider:db",
      type: "inject",
    })
    expect(map.edges).toContainEqual({
      source: "middleware:workflows/admin/_middleware.ts#0",
      target: "provider:db",
      type: "inject",
    })
  })

  it("runs folder middleware in front of the routes below it", () => {
    const mw = map.byKey.get("middleware:workflows/admin/_middleware.ts#0") as MiddlewareItem
    expect(mw.label).toBe("requireAdmin")
    expect(mw.covers.sort()).toEqual([
      "workflow:workflows/admin/pets/create.workflow",
      "workflow:workflows/admin/pets/list.workflow",
    ])
    expect((map.byKey.get("workflow:workflows/hello.workflow") as WorkflowItem).middleware).toEqual(
      [],
    )
  })

  it("keeps unused nodes and names them from the file when the schema has no name", () => {
    expect(map.byKey.get("node:nodes/unused.ts")?.label).toBe("Unused")
  })

  it("builds a folder tree with every member below it", () => {
    expect(map.folders.get("nodes")?.children).toEqual(["nodes/audit", "nodes/pets"])
    expect(map.folders.get("nodes/pets")?.members.sort()).toEqual([
      "node:nodes/pets/add-pet.ts",
      "node:nodes/pets/list-pets.ts",
    ])
  })
})

describe("connectedTo", () => {
  it("follows a workflow to its middleware, nodes and their providers", () => {
    expect([...connectedTo(map, "workflow:workflows/admin/pets/create.workflow")].sort()).toEqual([
      "middleware:workflows/admin/_middleware.ts#0",
      "node:nodes/audit/log.ts",
      "node:nodes/pets/add-pet.ts",
      "provider:db",
      "provider:logger",
      "workflow:workflows/admin/pets/create.workflow",
    ])
  })

  it("keeps a straight path to itself", () => {
    expect([...connectedTo(map, "workflow:workflows/hello.workflow")].sort()).toEqual([
      "node:nodes/say-hello.ts",
      "workflow:workflows/hello.workflow",
    ])
  })

  it("unions everything in a folder", () => {
    const keys = connectedTo(map, "folder:nodes/pets")
    expect(keys.has("workflow:workflows/admin/pets/list.workflow")).toBe(true)
    expect(keys.has("workflow:workflows/hello.workflow")).toBe(false)
  })
})

describe("visibleKeys", () => {
  it("hides switched-off kinds", () => {
    const keys = visibleKeys(map, new Set(["workflow", "node"]), new Set())
    expect([...keys].some((k) => k.startsWith("provider:"))).toBe(false)
    expect(keys.has("node:nodes/unused.ts")).toBe(true)
  })

  it("narrows to what a focus connects to", () => {
    const keys = visibleKeys(map, ALL, new Set(["provider:logger"]))
    expect([...keys].sort()).toEqual([
      "node:nodes/audit/log.ts",
      "provider:logger",
      "workflow:workflows/admin/pets/create.workflow",
    ])
  })
})
