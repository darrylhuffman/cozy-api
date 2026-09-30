import { testWorkflow, traceWorkflow } from "@darrylondil/lorien-runtime/testing"
import { describe, expect, it } from "vitest"
import { loadWorkflow, petStore } from "../../src/workflow-test-kit.js"

const workflow = await loadWorkflow("store/inventory")

describe("GET /store/inventory", () => {
  it("counts the seeded pets by status", async () => {
    const { nodes, services } = await petStore()
    const res = await testWorkflow(workflow, { request: { body: null }, nodes, services })
    expect(res).toEqual({
      status: 200,
      body: { available: 2, pending: 1, sold: 1 },
      headers: {},
    })
  })

  it("runs Get Inventory after the request, then responds", async () => {
    const { nodes, services } = await petStore()
    const trace = await traceWorkflow(workflow, { request: { body: null }, nodes, services })
    expect(trace.all().map((t) => t.nodeId)).toEqual(["Request", "GetInventory", "Response"])
  })

  it("reflects changes to the store", async () => {
    const { db, nodes, services } = await petStore()
    await db.updatePetStatus(1, "sold")
    const res = await testWorkflow(workflow, { request: { body: null }, nodes, services })
    expect(res.body).toEqual({ available: 1, pending: 1, sold: 2 })
  })
})
