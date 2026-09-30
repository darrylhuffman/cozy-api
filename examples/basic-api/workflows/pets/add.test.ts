import { testWorkflow, traceWorkflow } from "@darrylondil/lorien-runtime/testing"
import { describe, expect, it } from "vitest"
import { loadWorkflow, petStore } from "../../src/workflow-test-kit.js"

const workflow = await loadWorkflow("pets/add")

describe("POST /pets", () => {
  it("adds a pet and responds 201 with the stored record", async () => {
    const { db, nodes, services } = await petStore()
    const res = await testWorkflow(workflow, {
      request: { body: { name: "Nori", species: "cat" } },
      nodes,
      services,
    })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 5, name: "Nori", species: "cat", status: "available" })
    expect(await db.getPet(5)).toEqual(res.body)
  })

  it("passes the request body through to Add Pet", async () => {
    const { nodes, services } = await petStore()
    const trace = await traceWorkflow(workflow, {
      request: { body: { name: "Nori", species: "cat", status: "pending" } },
      nodes,
      services,
    })
    expect(trace.at("AddPet").input).toEqual({ name: "Nori", species: "cat", status: "pending" })
    expect(trace.at("AddPet").output.pet).toMatchObject({ status: "pending" })
  })

  it("fails without a name and stores nothing", async () => {
    const { db, nodes, services } = await petStore()
    await expect(
      testWorkflow(workflow, { request: { body: { species: "cat" } }, nodes, services }),
    ).rejects.toThrow(/name/)
    expect(await db.listPets()).toHaveLength(4)
  })
})
