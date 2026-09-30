import { testWorkflow, traceWorkflow } from "@darrylondil/lorien-runtime/testing"
import { describe, expect, it } from "vitest"
import { loadWorkflow, petStore } from "../../src/workflow-test-kit.js"

const workflow = await loadWorkflow("store/catalog")
const get = (query: Record<string, string> = {}) => ({ request: { body: null, query } })

describe("GET /store/catalog", () => {
  it("returns the first page of the catalog", async () => {
    const { nodes, services } = await petStore()
    const res = await testWorkflow(workflow, { ...get(), nodes, services })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      items: [
        { id: 1, name: "Biscuit", species: "Dog", status: "available", canOrder: true },
        { id: 2, name: "Miso", species: "Cat", status: "available", canOrder: true },
        { id: 3, name: "Pickles", species: "Rabbit", status: "pending", canOrder: false },
        { id: 4, name: "Captain", species: "Parrot", status: "sold", canOrder: false },
      ],
      page: 1,
      pageSize: 10,
      totalItems: 4,
      totalPages: 1,
      hasNextPage: false,
      storeCounts: { available: 2, pending: 1, sold: 1 },
    })
  })

  it("runs List Pets and Get Inventory side by side, then shapes their results", async () => {
    const { nodes, services } = await petStore()
    const trace = await traceWorkflow(workflow, {
      ...get({ status: "available", page: "2", pageSize: "1" }),
      nodes,
      services,
    })
    const order = trace.all().map((t) => t.nodeId)
    expect(order[0]).toBe("Request")
    expect(order.slice(1, 3).sort()).toEqual(["GetInventory", "ListPets"])
    expect(order.slice(3)).toEqual(["ToCatalogPage", "Response"])

    expect(trace.at("ListPets").input).toEqual({ status: "available" })
    expect(trace.at("ToCatalogPage").input).toMatchObject({
      pets: trace.at("ListPets").output.pets,
      inventory: trace.at("GetInventory").output.inventory,
      page: 2,
      pageSize: 1,
    })
    expect(trace.response.body).toMatchObject({
      items: [{ name: "Miso" }],
      totalItems: 2,
      totalPages: 2,
      hasNextPage: false,
    })
  })

  it("filters by species but still reports store-wide counts", async () => {
    const { nodes, services } = await petStore()
    const res = await testWorkflow(workflow, { ...get({ species: "parrot" }), nodes, services })
    expect(res.body).toMatchObject({
      items: [{ name: "Captain", canOrder: false }],
      totalItems: 1,
      storeCounts: { available: 2, pending: 1, sold: 1 },
    })
  })

  it("rejects a page size over 50", async () => {
    const { nodes, services } = await petStore()
    await expect(
      testWorkflow(workflow, { ...get({ pageSize: "500" }), nodes, services }),
    ).rejects.toThrow(/pageSize/)
  })
})
