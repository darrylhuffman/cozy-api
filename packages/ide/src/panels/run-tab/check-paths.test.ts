import { describe, expect, it } from "vitest"
import type { NodeSchemas, WorkflowFile } from "@/lib/api"
import {
  childrenOf,
  formatPath,
  mergeSchemas,
  nodeShapes,
  opsFor,
  responseBodySchema,
  schemaAt,
  schemaFromValue,
  splitPath,
  subjectSchema,
  typeName,
} from "./check-paths"

const pet = {
  type: "object",
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
    status: { type: "string", enum: ["available", "sold"] },
    tags: { type: "array", items: { type: "object", properties: { label: { type: "string" } } } },
  },
}

const schemas: Record<string, NodeSchemas> = {
  "./nodes/add-pet": {
    inputs: { type: "object", properties: { name: { type: "string" } } },
    outputs: { type: "object", properties: { pet } },
  },
  "./nodes/list-pets": {
    inputs: { type: "object", properties: {} },
    outputs: { type: "object", properties: { pets: { type: "array", items: pet } } },
  },
}

describe("paths", () => {
  it("formats and splits segments, keeping indexes as numbers", () => {
    expect(formatPath(["pets", 0, "name"])).toBe("pets[0].name")
    expect(formatPath([2, "id"])).toBe("[2].id")
    expect(formatPath(["odd key", "x"])).toBe('["odd key"].x')
    expect(splitPath("pets[3].name")).toEqual(["pets", 3, "name"])
    expect(splitPath("[0].id")).toEqual([0, "id"])
    expect(splitPath('data["odd key"]')).toEqual(["data", "odd key"])
    expect(splitPath("")).toEqual([])
    expect(splitPath("a..b")).toBeNull()
  })
})

describe("schemas", () => {
  it("reads fields through arrays", () => {
    const list = { type: "array", items: pet }
    expect(typeName(schemaAt(list, [4, "status"]))).toBe("enum")
    expect(typeName(schemaAt(pet, ["tags", 1, "label"]))).toBe("string")
    expect(schemaAt(pet, ["nope"])).toBeUndefined()
    expect(childrenOf(list)).toEqual([{ key: 0, schema: pet }])
  })

  it("guesses a schema from a value and merges it with a declared one", () => {
    const seen = schemaFromValue({ id: 1, extra: [{ a: true }] })
    expect(typeName(schemaAt(seen, ["extra", 0, "a"]))).toBe("boolean")
    const merged = mergeSchemas([pet, seen])
    expect(Object.keys(merged?.properties ?? {})).toEqual(["id", "name", "status", "tags", "extra"])
    expect(typeName(schemaAt(merged, ["status"]))).toBe("enum")
  })

  it("finds the body each Response sends from its source's outputs", () => {
    const wf: WorkflowFile = {
      lorien: 1,
      nodes: {
        List: { uses: "./nodes/list-pets" },
        Response: { uses: "@core/http-response", in: { body: "List.pets" } },
      },
    } as WorkflowFile
    expect(typeName(responseBodySchema(wf, schemas))).toBe("array")
    expect(typeName(schemaAt(responseBodySchema(wf, schemas), [0, "name"]))).toBe("string")
  })

  it("types a check's subject for body, header, status and node checks", () => {
    const wf = {
      lorien: 1,
      nodes: { AddPet: { uses: "./nodes/add-pet" } },
    } as unknown as WorkflowFile
    const shapes = { body: pet, headers: [], nodes: nodeShapes(wf, schemas) }
    expect(typeName(subjectSchema({ target: "body", path: "status", op: "equals" }, shapes))).toBe(
      "enum",
    )
    expect(typeName(subjectSchema({ target: "status", op: "equals" }, shapes))).toBe("number")
    expect(
      typeName(
        subjectSchema(
          { target: "node", node: "AddPet", path: "output.pet.id", op: "equals" },
          shapes,
        ),
      ),
    ).toBe("number")
    expect(
      typeName(
        subjectSchema({ target: "node", node: "AddPet", path: "input.name", op: "equals" }, shapes),
      ),
    ).toBe("string")
  })

  it("offers comparisons that fit the type, keeping the current one", () => {
    expect(opsFor({ type: "number" })).toContain("lessThan")
    expect(opsFor({ type: "string" })).not.toContain("lessThan")
    expect(opsFor({ type: "boolean" }, "contains")).toContain("contains")
    expect(opsFor(undefined)).toHaveLength(9)
  })
})
