import { testWorkflow, traceWorkflow } from "@darrylondil/lorien-runtime/testing"
import { describe, expect, it } from "vitest"
import { loadWorkflow, petStore } from "../../../src/workflow-test-kit.js"

const workflow = await loadWorkflow("store/orders/place")

describe("POST /store/orders", () => {
  it("places an order for an available pet and marks it pending", async () => {
    const { db, nodes, services } = await petStore()
    const res = await testWorkflow(workflow, {
      request: { body: { petId: 1, quantity: 2 } },
      nodes,
      services,
    })
    expect(res).toMatchObject({
      status: 201,
      body: { id: 1, petId: 1, quantity: 2, status: "placed" },
    })
    expect((await db.getPet(1))?.status).toBe("pending")
  })

  it("defaults the quantity to 1", async () => {
    const { nodes, services } = await petStore()
    const trace = await traceWorkflow(workflow, {
      request: { body: { petId: 2 } },
      nodes,
      services,
    })
    expect(trace.at("PlaceOrder").input).toEqual({ petId: 2, quantity: 1 })
  })

  it("responds 409 when the pet is not available", async () => {
    const { nodes, services } = await petStore()
    const res = await testWorkflow(workflow, { request: { body: { petId: 4 } }, nodes, services })
    expect(res).toMatchObject({ status: 409, body: { error: "Captain is sold" } })
  })

  it("refuses the same pet twice", async () => {
    const { nodes, services } = await petStore()
    const order = { request: { body: { petId: 1 } }, nodes, services }
    expect((await testWorkflow(workflow, order)).status).toBe(201)
    expect((await testWorkflow(workflow, order)).status).toBe(409)
  })

  it("responds 404 for a pet that does not exist", async () => {
    const { nodes, services } = await petStore()
    const res = await testWorkflow(workflow, { request: { body: { petId: 99 } }, nodes, services })
    expect(res.status).toBe(404)
  })
})
