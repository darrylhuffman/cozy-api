import { testWorkflow, traceWorkflow } from "@darrylondil/lorien-runtime/testing"
import { describe, expect, it } from "vitest"
import { loadWorkflow, petStore } from "../../src/workflow-test-kit.js"

const workflow = await loadWorkflow("pets/update")

describe("PATCH /pets/:id", () => {
  it("updates the pet's status and responds with it", async () => {
    const { db, nodes, services } = await petStore()
    const res = await testWorkflow(workflow, {
      request: { params: { id: "2" }, body: { status: "sold" } },
      nodes,
      services,
    })
    expect(res).toMatchObject({ status: 200, body: { id: 2, name: "Miso", status: "sold" } })
    expect((await db.getPet(2))?.status).toBe("sold")
  })

  it("takes the id from the path and the status from the body", async () => {
    const { nodes, services } = await petStore()
    const trace = await traceWorkflow(workflow, {
      request: { params: { id: "3" }, body: { status: "available" } },
      nodes,
      services,
    })
    expect(trace.at("UpdatePetStatus").input).toEqual({ id: 3, status: "available" })
  })

  it("responds 404 for a pet that does not exist", async () => {
    const { nodes, services } = await petStore()
    const res = await testWorkflow(workflow, {
      request: { params: { id: "99" }, body: { status: "sold" } },
      nodes,
      services,
    })
    expect(res.status).toBe(404)
  })

  it("rejects an unknown status and leaves the pet alone", async () => {
    const { db, nodes, services } = await petStore()
    await expect(
      testWorkflow(workflow, {
        request: { params: { id: "1" }, body: { status: "adopted" } },
        nodes,
        services,
      }),
    ).rejects.toThrow(/status/)
    expect((await db.getPet(1))?.status).toBe("available")
  })
})
