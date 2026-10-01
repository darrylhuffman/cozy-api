import { describe, expect, it } from "vitest"
import { buildDisplay } from "./display"
import { petShop } from "./fixture.test-data"
import { graphLayout, lanesLayout, sharedDepth } from "./layout"
import { buildAppMap, visibleKeys } from "./model"

const ALL = new Set(["workflow", "node", "middleware", "provider"] as const)
const measure = (t: string) => t.length * 6.3

function display(
  kinds = ALL as ReadonlySet<"workflow" | "node" | "middleware" | "provider">,
  group = false,
) {
  const map = buildAppMap(petShop)
  return buildDisplay(map, { group, visible: visibleKeys(map, kinds, new Set()), measure })
}

describe("lanesLayout", () => {
  it("puts a straight path on one row", () => {
    const { positions } = lanesLayout(display())
    const hello = positions.get("workflow:workflows/hello.workflow")
    const greet = positions.get("node:nodes/say-hello.ts")
    expect(hello && greet && Math.abs(hello.y - greet.y)).toBeLessThan(1)
  })

  it("orders lanes left to right and drops empty ones", () => {
    const { laneX } = lanesLayout(display(new Set(["workflow", "node"])))
    expect(Object.keys(laneX)).toEqual(["workflow", "node"])
    expect(laneX.workflow).toBeLessThan(laneX.node ?? 0)
  })

  it("never overlaps two shapes in a lane", () => {
    const graph = display()
    const { positions } = lanesLayout(graph)
    for (const kind of ["workflow", "node", "provider"] as const) {
      const col = graph.shapes
        .filter((s) => s.kind === kind)
        .map((s) => ({ s, y: positions.get(s.key)?.y ?? 0 }))
        .sort((a, b) => a.y - b.y)
      for (let i = 1; i < col.length; i++) {
        const a = col[i - 1]!
        const b = col[i]!
        expect(b.y + b.s.oy - b.s.hh).toBeGreaterThanOrEqual(a.y + a.s.oy + a.s.hh - 0.5)
      }
    }
  })
})

describe("graphLayout", () => {
  it("places every shown shape", () => {
    const graph = display()
    const positions = graphLayout(graph, { ticks: 50 })
    for (const s of graph.shapes) expect(Number.isFinite(positions.get(s.key)?.x)).toBe(true)
  })
})

describe("grouping", () => {
  it("draws one bubble per folder with several siblings", () => {
    const graph = display(ALL, true)
    expect(graph.rep.get("node:nodes/pets/add-pet.ts")?.key).toBe("folder:nodes/pets")
    expect(graph.rep.get("workflow:workflows/hello.workflow")?.key).toBe(
      "workflow:workflows/hello.workflow",
    )
    const edge = graph.edges.find(
      (e) => e.source === "folder:nodes/pets" && e.target === "provider:db",
    )
    expect(edge?.weight).toBe(2)
  })
})

describe("sharedDepth", () => {
  it("counts leading folders in common", () => {
    expect(sharedDepth("nodes/pets", "nodes/orders")).toBe(1)
    expect(sharedDepth("nodes/pets/x", "nodes/pets")).toBe(2)
  })
})
