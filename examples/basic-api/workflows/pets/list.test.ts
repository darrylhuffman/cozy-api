import { testWorkflow, traceWorkflow } from "@darrylondil/lorien-runtime/testing"
import { describe, expect, it } from "vitest"
import { loadWorkflow, petStore } from "../../src/workflow-test-kit.js"

const workflow = await loadWorkflow("pets/list")

describe("GET /pets", () => {
  it("lists every pet with no filters", async () => {
    const { nodes, services } = await petStore()
    const res = await testWorkflow(workflow, { request: { body: null }, nodes, services })
    expect(res.status).toBe(200)
    expect((res.body as { name: string }[]).map((p) => p.name)).toEqual([
      "Biscuit",
      "Miso",
      "Pickles",
      "Captain",
    ])
  })

  it("maps query params onto the List Pets filters", async () => {
    const { nodes, services } = await petStore()
    const trace = await traceWorkflow(workflow, {
      request: { body: null, query: { status: "available", species: "cat" } },
      nodes,
      services,
    })
    expect(trace.at("ListPets").input).toEqual({ status: "available", species: "cat" })
    expect(trace.response.body).toEqual([
      { id: 2, name: "Miso", species: "cat", status: "available" },
    ])
  })

  it("rejects an unknown status", async () => {
    const { nodes, services } = await petStore()
    await expect(
      testWorkflow(workflow, {
        request: { body: null, query: { status: "lost" } },
        nodes,
        services,
      }),
    ).rejects.toThrow(/status/)
  })
})
