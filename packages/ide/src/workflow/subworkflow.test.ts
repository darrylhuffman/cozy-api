import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import {
  addInputField,
  addOutput,
  fieldSchema,
  fieldTypeName,
  invalidPortName,
  isSubworkflowPath,
  removeInputField,
  removeOutput,
  renameInputField,
  renameOutput,
  setInputFieldType,
  subworkflowSeed,
  subworkflowUses,
} from "./subworkflow"

const wf: WorkflowFile = {
  lorien: 1,
  nodes: {
    Input: { uses: "@core/input", values: { fields: { eventId: "string", quantity: "number" } } },
    Find: { uses: "./nodes/events/find", in: { id: "Input.eventId" } },
    Gate: { uses: "@core/response", when: "!Input.eventIdentity", values: { status: 400 } },
    Skip: { uses: "@core/response", when: "!Input.eventId", values: { status: 404 } },
    Output: { uses: "@core/output", in: { event: "Find.event" } },
  },
}

describe("sub-workflow paths", () => {
  it("knows a sub-workflow file and its uses key", () => {
    expect(isSubworkflowPath("nodes/orders/reserve.workflow")).toBe(true)
    expect(isSubworkflowPath("workflows/orders/create.workflow")).toBe(false)
    expect(isSubworkflowPath("nodes/orders/reserve.ts")).toBe(false)
    expect(subworkflowUses("nodes/orders/reserve.workflow")).toBe("./nodes/orders/reserve")
  })

  it("seeds a new file with an Input and an Output", () => {
    const seed = JSON.parse(subworkflowSeed()) as WorkflowFile
    expect(Object.values(seed.nodes).map((n) => n.uses)).toEqual(["@core/input", "@core/output"])
  })
})

describe("Input fields", () => {
  it("adds an input with a free name", () => {
    const once = addInputField(wf, "Input")
    expect(once.name).toBe("input")
    const twice = addInputField(once.workflow, "Input")
    expect(twice.name).toBe("input2")
    expect(twice.workflow.nodes.Input?.values?.fields).toEqual({
      eventId: "string",
      quantity: "number",
      input: "string",
      input2: "string",
    })
  })

  it("renames an input in place and every read of it, but not look-alikes", () => {
    const next = renameInputField(wf, "Input", "eventId", "id")
    expect(Object.keys(next?.nodes.Input?.values?.fields as object)).toEqual(["id", "quantity"])
    expect(next?.nodes.Find?.in).toEqual({ id: "Input.id" })
    expect(next?.nodes.Skip?.when).toBe("!Input.id")
    expect(next?.nodes.Gate?.when).toBe("!Input.eventIdentity")
  })

  it("refuses a taken or unusable name", () => {
    expect(renameInputField(wf, "Input", "eventId", "quantity")).toBeNull()
    expect(renameInputField(wf, "Input", "eventId", "event id")).toBeNull()
    expect(invalidPortName("2x")).not.toBeNull()
    expect(invalidPortName("ok_name")).toBeNull()
  })

  it("retypes and removes inputs", () => {
    const typed = setInputFieldType(wf, "Input", "quantity", "string")
    expect(typed.nodes.Input?.values?.fields).toEqual({ eventId: "string", quantity: "string" })
    const removed = removeInputField(wf, "Input", "quantity")
    expect(removed.nodes.Input?.values?.fields).toEqual({ eventId: "string" })
  })

  it("maps a field's type to a schema and to the picker", () => {
    expect(fieldSchema("number")).toEqual({ type: "number" })
    expect(fieldSchema("json")).toEqual({ type: "object" })
    expect(fieldSchema({ type: "array" })).toEqual({ type: "array" })
    expect(fieldTypeName("boolean")).toBe("boolean")
    expect(fieldTypeName({ type: "array" })).toBeNull()
  })
})

describe("Output", () => {
  it("names a new output after what it reads, avoiding taken names", () => {
    const first = addOutput(wf, "Output", "Find.total")
    expect(first?.name).toBe("total")
    const clash = addOutput(wf, "Output", "Find.event")
    expect(clash?.name).toBe("event2")
    expect(clash?.workflow.nodes.Output?.in).toEqual({ event: "Find.event", event2: "Find.event" })
    expect(addOutput(wf, "Output", "Find")?.name).toBe("FindValue")
  })

  it("renames and removes outputs", () => {
    expect(renameOutput(wf, "Output", "event", "found")?.nodes.Output?.in).toEqual({
      found: "Find.event",
    })
    expect(renameOutput(wf, "Output", "event", "bad name")).toBeNull()
    expect(removeOutput(wf, "Output", "event").nodes.Output?.in).toBeUndefined()
  })
})
