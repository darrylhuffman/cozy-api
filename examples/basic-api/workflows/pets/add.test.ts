import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseWorkflowFromString } from "@darrylondil/lorien-runtime"
import { testWorkflow, traceWorkflow } from "@darrylondil/lorien-runtime/testing"
import { describe, expect, it } from "vitest"
import addPet from "../../nodes/pets/add-pet.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const workflow = parseWorkflowFromString(readFileSync(join(__dirname, "add.workflow"), "utf-8"))

const nodes = { "./nodes/pets/add-pet": addPet }

// A stand-in db: workflow tests exercise the wiring, not SQLite.
const services = {
  db: {
    async addPet(pet: { name: string; species: string; status: string }) {
      return { id: 7, ...pet }
    },
  },
  logger: { info: () => {} },
}

describe("POST /pets workflow", () => {
  it("adds a pet and responds 201 with it", async () => {
    const res = await testWorkflow(workflow, {
      request: { body: { name: "Nori", species: "cat" } },
      nodes,
      services,
    })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 7, name: "Nori", species: "cat", status: "available" })
  })

  it("rejects a pet without a name by throwing", async () => {
    await expect(
      testWorkflow(workflow, { request: { body: { species: "cat" } }, nodes, services }),
    ).rejects.toThrow()
  })

  it("traceWorkflow exposes intermediate node outputs", async () => {
    const trace = await traceWorkflow(workflow, {
      request: { body: { name: "Nori", species: "cat", status: "pending" } },
      nodes,
      services,
    })
    expect(trace.at("AddPet").output).toEqual({
      pet: { id: 7, name: "Nori", species: "cat", status: "pending" },
    })
  })
})
