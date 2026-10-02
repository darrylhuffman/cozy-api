import { parseWorkflow } from "@darrylondil/lorien-runtime"
import { describe, expect, it } from "vitest"
import { CORE_SCHEMAS, subworkflowSchemas } from "./introspect-workspace.js"

const findEvent = {
  name: "Find Event",
  inputs: { type: "object", properties: { id: { type: "string" } } },
  outputs: {
    type: "object",
    properties: {
      found: { type: "boolean" },
      event: { type: "object", properties: { id: { type: "string" } } },
    },
  },
}

const requireEvent = parseWorkflow({
  lorien: 1,
  label: "Require event",
  nodes: {
    Input: {
      uses: "@core/input",
      values: { fields: { eventId: "string", tier: { enum: ["a", "b"] } } },
    },
    Find: { uses: "./nodes/events/find-event", in: { id: "Input.eventId" } },
    NotFound: { uses: "@core/response", when: "!Find.found", values: { status: 404 } },
    Teapot: { uses: "@core/response", when: "Find.found", in: { status: "Find.found" } },
    Output: {
      uses: "@core/output",
      in: { event: "Find.event", eventId: "Find.event.id", tier: "Input.tier" },
    },
  },
})

const outer = parseWorkflow({
  lorien: 1,
  nodes: {
    Input: { uses: "@core/input", values: { fields: { id: "string" } } },
    Require: { uses: "./nodes/events/require-event", in: { eventId: "Input.id" } },
    Output: { uses: "@core/output", in: { event: "Require.event" } },
  },
})

const subs = {
  "./nodes/events/require-event": {
    uses: "./nodes/events/require-event",
    relativePath: "nodes/events/require-event.workflow",
    file: requireEvent,
  },
  "./nodes/events/load-event": {
    uses: "./nodes/events/load-event",
    relativePath: "nodes/events/load-event.workflow",
    file: outer,
  },
}

describe("subworkflowSchemas", () => {
  const schemas = subworkflowSchemas(subs, {
    ...CORE_SCHEMAS,
    "./nodes/events/find-event": findEvent,
  })

  it("types inputs from the Input's fields and outputs from what the Output reads", () => {
    expect(schemas["./nodes/events/require-event"]).toEqual({
      name: "Require event",
      color: null,
      description: null,
      inputs: {
        type: "object",
        properties: { eventId: { type: "string" }, tier: { enum: ["a", "b"] } },
      },
      outputs: {
        type: "object",
        properties: {
          event: { type: "object", properties: { id: { type: "string" } } },
          eventId: { type: "string" },
          tier: { enum: ["a", "b"] },
        },
      },
      subworkflow: {
        path: "nodes/events/require-event.workflow",
        respondsWith: [404],
        responds: true,
        mockable: ["Find"],
        nodeCount: 3,
      },
    })
  })

  it("follows a nested sub-workflow's outputs and names an unlabelled one from its file", () => {
    const load = schemas["./nodes/events/load-event"]
    expect(load?.name).toBe("Load event")
    expect(load?.outputs.properties?.event).toEqual(findEvent.outputs.properties.event)
    // Its nested sub-workflow's Response answers the request too.
    expect(load?.subworkflow).toMatchObject({
      respondsWith: [404],
      responds: true,
      // Nested nodes go by their flattened id.
      mockable: ["Require__Find"],
    })
  })
})
