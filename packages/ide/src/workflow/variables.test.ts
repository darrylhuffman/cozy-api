import { describe, expect, it } from "vitest"
import type { JsonSchema, WorkflowFile } from "@/lib/api"
import {
  checkValue,
  describeVariable,
  extractVariable,
  scaffoldValue,
  schemaAtPath,
  typeLabel,
  variableKind,
  variableSchema,
  variableTargets,
} from "./variables"

// Roughly what z.toJSONSchema gives for a checkout node's input.
const checkout: JsonSchema = {
  type: "object",
  properties: {
    role: { type: "string", enum: ["member", "admin", "owner"] },
    stack: { type: "boolean", default: false },
    maxPct: { type: "number", minimum: 0, maximum: 100 },
    email: { type: "string", format: "email" },
    note: { anyOf: [{ type: "string" }, { type: "null" }] },
    shipping: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["standard", "express"], default: "standard" },
        address: {
          type: "object",
          properties: {
            line1: { type: "string" },
            country: { type: "string", default: "US" },
            geo: { type: "object", properties: { lat: { type: "number" } } },
          },
          required: ["line1"],
        },
        gift: { type: "boolean" },
        items: { type: "array", items: { type: "string" } },
        extra: { type: "object", additionalProperties: {} },
      },
      required: ["method", "address"],
    },
  },
  required: ["role"],
}

describe("scaffoldValue", () => {
  it("uses defaults, the first enum option and empty values", () => {
    expect(scaffoldValue(schemaAtPath(checkout, "role"))).toBe("member")
    expect(scaffoldValue(schemaAtPath(checkout, "stack"))).toBe(false)
    expect(scaffoldValue(schemaAtPath(checkout, "maxPct"))).toBe(0)
    expect(scaffoldValue(schemaAtPath(checkout, "email"))).toBe("")
    expect(scaffoldValue(schemaAtPath(checkout, "note"))).toBe("")
  })

  it("lays objects out two levels deep and leaves the third empty", () => {
    expect(scaffoldValue(schemaAtPath(checkout, "shipping"))).toEqual({
      method: "standard",
      address: { line1: "", country: "US", geo: {} },
      gift: false,
      items: [],
      extra: {},
    })
  })
})

describe("checkValue", () => {
  const shipping = schemaAtPath(checkout, "shipping")
  it("passes a value that fits", () => {
    expect(checkValue(shipping, scaffoldValue(shipping))).toBeNull()
    expect(checkValue(schemaAtPath(checkout, "note"), null)).toBeNull()
  })
  it("names the first thing that doesn't fit", () => {
    expect(checkValue(shipping, { method: "standard" })).toBe("address is required")
    expect(checkValue(shipping, { method: "fast", address: { line1: "" } })).toBe(
      'method: must be one of "standard", "express"',
    )
    expect(checkValue(shipping, { method: "standard", address: { line1: 4 } })).toBe(
      "address.line1: must be a string",
    )
    expect(checkValue(shipping, { method: "standard", address: { line1: "" }, items: [1] })).toBe(
      "items[0]: must be a string",
    )
    expect(checkValue(schemaAtPath(checkout, "maxPct"), 120)).toBe("must be at most 100")
  })
})

describe("variable types", () => {
  it("picks an editor and a type name", () => {
    expect(variableKind(schemaAtPath(checkout, "role"), undefined)).toBe("enum")
    expect(variableKind(schemaAtPath(checkout, "note"), undefined)).toBe("string")
    expect(variableKind(schemaAtPath(checkout, "shipping"), undefined)).toBe("json")
    expect(variableKind(undefined, 3)).toBe("number")
    expect(typeLabel(schemaAtPath(checkout, "role"), "member")).toBe("enum")
    expect(typeLabel(undefined, [1])).toBe("array")
  })
  it("describes the variable a drag will make", () => {
    expect(describeVariable(schemaAtPath(checkout, "role"))).toBe("Select · 3 options")
    expect(describeVariable(schemaAtPath(checkout, "shipping"))).toBe("Object · 5 fields")
    expect(describeVariable(undefined)).toBe("JSON")
  })
})

describe("extractVariable", () => {
  const wf: WorkflowFile = {
    lorien: 1,
    nodes: {
      req: { uses: "@core/http-request" },
      checkout: {
        uses: "./nodes/checkout",
        in: { email: "req.body.email" },
        values: { maxPct: 40, stack: true },
      },
    },
  }
  const schemas = { "./nodes/checkout": { inputs: checkout, outputs: { type: "object" } } }

  it("adds a variable seeded from the input's literal and wires the input to it", () => {
    const res = extractVariable(wf, {
      target: "checkout",
      portId: "maxPct",
      schema: schemaAtPath(checkout, "maxPct"),
      position: { x: 10, y: 20 },
    })
    expect(res?.id).toBe("maxPct")
    expect(res?.workflow.nodes.maxPct).toEqual({ uses: "@core/variable", values: { value: 40 } })
    expect(res?.workflow.nodes.checkout).toEqual({
      uses: "./nodes/checkout",
      in: { email: "req.body.email", maxPct: "maxPct.value" },
      values: { stack: true },
    })
    expect(res?.workflow.view?.maxPct).toEqual({ x: 10, y: 20 })
    const next = res!.workflow
    expect(variableTargets(next, "maxPct")).toEqual([{ nodeId: "checkout", portId: "maxPct" }])
    expect(variableSchema(next, schemas, "maxPct")).toEqual(schemaAtPath(checkout, "maxPct"))
  })

  it("scaffolds nested inputs and picks a free name", () => {
    const withCity: WorkflowFile = { ...wf, nodes: { ...wf.nodes, address: { uses: "./x" } } }
    const res = extractVariable(withCity, {
      target: "checkout",
      portId: "shipping.address",
      schema: schemaAtPath(checkout, "shipping.address"),
      position: { x: 0, y: 0 },
    })
    expect(res?.id).toBe("address2")
    expect(res?.workflow.nodes.address2?.values?.value).toEqual({
      line1: "",
      country: "US",
      geo: { lat: 0 },
    })
    expect((res?.workflow.nodes.checkout?.in as Record<string, string>)["shipping.address"]).toBe(
      "address2.value",
    )
  })
})
