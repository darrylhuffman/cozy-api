import { testWorkflow, traceWorkflow } from "@darrylondil/lorien-runtime/testing"
import { describe, expect, it } from "vitest"
import { loadWorkflow, petStore } from "../../src/workflow-test-kit.js"

const workflow = await loadWorkflow("pets/get")

describe("GET /pets/:id", () => {
  it("responds 200 with the pet", async () => {
    const { nodes, services } = await petStore()
    const res = await testWorkflow(workflow, {
      request: { body: null, params: { id: "1" } },
      nodes,
      services,
    })
    expect(res).toMatchObject({
      status: 200,
      body: { id: 1, name: "Biscuit", species: "dog", status: "available" },
    })
  })

  it("wires Find Pet's status output into the response", async () => {
    const { nodes, services } = await petStore()
    const trace = await traceWorkflow(workflow, {
      request: { body: null, params: { id: "99" } },
      nodes,
      services,
    })
    expect(trace.at("FindPet").input).toEqual({ id: 99 })
    expect(trace.at("FindPet").output.status).toBe(404)
    expect(trace.response).toMatchObject({ status: 404, body: { error: "pet 99 not found" } })
  })

  it("rejects an id that is not a number", async () => {
    const { nodes, services } = await petStore()
    await expect(
      testWorkflow(workflow, { request: { body: null, params: { id: "rex" } }, nodes, services }),
    ).rejects.toThrow(/id/)
  })
})
