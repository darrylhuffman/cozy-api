import { describe, expect, it } from "vitest"
import type { NodeSchemas, WorkflowFile } from "@/lib/api"
import {
  analyzeExtraction,
  extractSubworkflow,
  humanize,
  inlineSubworkflow,
  slugify,
  subworkflowPathFor,
} from "./extract-subworkflow"

const schemas: Record<string, NodeSchemas> = {
  "@core/http-request": {
    inputs: {},
    outputs: {
      type: "object",
      properties: {
        body: {
          type: "object",
          properties: { eventId: { type: "string" }, quantity: { type: "integer" } },
        },
        params: { type: "object" },
      },
    },
  },
  "./nodes/events/find-event": {
    inputs: {},
    outputs: {
      type: "object",
      properties: { found: { type: "boolean" }, event: { type: "object" } },
    },
  },
}

const route: WorkflowFile = {
  lorien: 1,
  nodes: {
    Request: { uses: "@core/http-request", values: { method: "POST", path: "/orders" } },
    FindEvent: { uses: "./nodes/events/find-event", in: { id: "Request.body.eventId" } },
    NoEvent: { uses: "@core/http-response", when: "!FindEvent.found", values: { status: 404 } },
    Capacity: {
      uses: "./nodes/events/check-capacity",
      in: { event: "FindEvent.event", quantity: "Request.body.quantity" },
      when: "FindEvent.found",
    },
    Create: {
      uses: "./nodes/orders/create",
      in: { event: "FindEvent.event.id", seats: "Capacity.seats" },
    },
    Done: { uses: "@core/http-response", in: { body: "Create.order" } },
  },
  view: {
    Request: { x: 0, y: 0 },
    FindEvent: { x: 300, y: 0 },
    NoEvent: { x: 600, y: 200 },
    Capacity: { x: 600, y: 0 },
    Create: { x: 900, y: 0 },
    Done: { x: 1200, y: 0 },
  },
}

const SELECTED = ["FindEvent", "NoEvent", "Capacity"]

describe("analyzeExtraction", () => {
  it("finds the inputs, outputs, responses, folder and a name", () => {
    const plan = analyzeExtraction(route, SELECTED, schemas, "workflows/orders/create.workflow")
    expect(plan.errors).toEqual([])
    expect(plan.nodeIds).toEqual(SELECTED)
    expect(plan.inputs).toEqual([
      { source: "Request.body.eventId", name: "id", type: "string" },
      { source: "Request.body.quantity", name: "quantity", type: "number" },
    ])
    expect(plan.outputs).toEqual([
      { source: "FindEvent.event", name: "event" },
      { source: "Capacity.seats", name: "seats" },
    ])
    expect(plan.when).toBeNull()
    expect(plan.responds).toEqual([404])
    expect(plan.folder).toBe("events")
    expect(plan.name).toBe("Find event")
  })

  it("refuses the trigger and nodes that sit between selected ones", () => {
    expect(
      analyzeExtraction(route, ["Request", "FindEvent"], schemas, "workflows/a.workflow").errors[0],
    ).toMatch(/Request is the workflow's trigger/)
    // Capacity reads FindEvent and feeds Create.
    const gap = analyzeExtraction(route, ["FindEvent", "Create"], schemas, "workflows/a.workflow")
    expect(gap.errors).toEqual([expect.stringMatching(/^Capacity reads from the selection/)])
  })

  it("moves a condition every first node shares onto the new node", () => {
    const plan = analyzeExtraction(route, ["Capacity", "Create"], schemas, "workflows/a.workflow")
    expect(plan.when).toBe("FindEvent.found")
    // FindEvent.event.id reads through the event input.
    expect(plan.inputs).toEqual([
      { source: "FindEvent.event", name: "event", type: "json" },
      { source: "Request.body.quantity", name: "quantity", type: "number" },
    ])
    expect(plan.folder).toBe("shared")
  })

  it("turns a condition on an outside value into a boolean input", () => {
    const plan = analyzeExtraction(route, ["NoEvent"], schemas, "workflows/orders/a.workflow")
    expect(plan.when).toBe("!FindEvent.found")
    expect(plan.inputs).toEqual([])
    const two = analyzeExtraction(route, ["NoEvent", "Capacity"], schemas, "workflows/a.workflow")
    expect(two.when).toBeNull()
    expect(two.inputs).toContainEqual({ source: "FindEvent.found", name: "found", type: "boolean" })
  })

  it("names an output for a whole-node read after the node", () => {
    const wf: WorkflowFile = {
      lorien: 1,
      nodes: {
        Load: { uses: "./nodes/a/load" },
        Use: { uses: "./nodes/a/use", in: "Load" },
      },
    }
    expect(analyzeExtraction(wf, ["Load"], {}, "workflows/a.workflow").outputs).toEqual([
      { source: "Load", name: "load" },
    ])
  })
})

describe("extractSubworkflow", () => {
  const plan = analyzeExtraction(route, SELECTED, schemas, "workflows/orders/create.workflow")

  it("writes a sub-workflow that reads its Input and hands out its outputs", () => {
    const { sub, path } = extractSubworkflow(route, plan, {
      name: "Require event",
      folder: "events",
    })
    expect(path).toBe("nodes/events/require-event.workflow")
    expect(sub.label).toBe("Require event")
    expect(sub.nodes).toEqual({
      Input: { uses: "@core/input", values: { fields: { id: "string", quantity: "number" } } },
      FindEvent: { uses: "./nodes/events/find-event", in: { id: "Input.id" } },
      NoEvent: { uses: "@core/http-response", when: "!FindEvent.found", values: { status: 404 } },
      Capacity: {
        uses: "./nodes/events/check-capacity",
        in: { event: "FindEvent.event", quantity: "Input.quantity" },
        when: "FindEvent.found",
      },
      Output: { uses: "@core/output", in: { event: "FindEvent.event", seats: "Capacity.seats" } },
    })
    expect(sub.view?.Input).toEqual({ x: 0, y: 100 })
    expect(sub.view?.FindEvent).toEqual({ x: 360, y: 0 })
    expect(sub.view?.Output).toEqual({ x: 1020, y: 100 })
  })

  it("puts one node in the group's place, wired the same way", () => {
    const { caller, nodeId } = extractSubworkflow(route, plan, {
      name: "Require event",
      folder: "events",
      outputNames: ["found", "seats"],
    })
    expect(nodeId).toBe("RequireEvent")
    expect(Object.keys(caller.nodes)).toEqual(["Request", "RequireEvent", "Create", "Done"])
    expect(caller.nodes.RequireEvent).toEqual({
      uses: "./nodes/events/require-event",
      in: { id: "Request.body.eventId", quantity: "Request.body.quantity" },
    })
    expect(caller.nodes.Create?.in).toEqual({
      event: "RequireEvent.found.id",
      seats: "RequireEvent.seats",
    })
    expect(caller.view?.RequireEvent).toEqual({ x: 500, y: 67 })
    expect(caller.view?.FindEvent).toBeUndefined()
  })

  it("picks a free file name and lifts the shared condition and waits", () => {
    const wf: WorkflowFile = {
      ...route,
      nodes: {
        ...route.nodes,
        Capacity: {
          ...(route.nodes.Capacity as WorkflowFile["nodes"][string]),
          after: ["Request"],
        },
        Done: { ...(route.nodes.Done as WorkflowFile["nodes"][string]), after: ["Create"] },
      },
    }
    const lifted = analyzeExtraction(wf, ["Capacity", "Create"], schemas, "workflows/a.workflow")
    const out = extractSubworkflow(wf, lifted, {
      name: "Reserve",
      folder: "orders",
      exists: (p) => p === "nodes/orders/reserve.workflow",
    })
    expect(out.path).toBe("nodes/orders/reserve-2.workflow")
    expect(out.caller.nodes.Reserve).toMatchObject({ when: "FindEvent.found", after: ["Request"] })
    expect(out.caller.nodes.Done?.after).toEqual(["Reserve"])
    expect(out.sub.nodes.Capacity?.when).toBeUndefined()
    expect(out.sub.nodes.Capacity?.after).toBeUndefined()
  })

  it("comes back to the same workflow when inlined", () => {
    const { caller, sub, nodeId } = extractSubworkflow(route, plan, {
      name: "Require event",
      folder: "events",
    })
    const back = inlineSubworkflow(caller, nodeId, sub)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.workflow.nodes).toEqual(route.nodes)
    expect(back.nodeIds).toEqual(SELECTED)
    expect(back.workflow.view?.FindEvent).toEqual({ x: 500, y: 67 })
  })

  it("comes back the same with a lifted condition", () => {
    const lifted = analyzeExtraction(route, ["Capacity", "Create"], schemas, "workflows/a.workflow")
    const { caller, sub, nodeId } = extractSubworkflow(route, lifted, {
      name: "Reserve",
      folder: "x",
    })
    const back = inlineSubworkflow(caller, nodeId, sub)
    expect(back.ok && back.workflow.nodes).toEqual(route.nodes)
  })
})

describe("inlineSubworkflow", () => {
  const sub: WorkflowFile = {
    lorien: 1,
    nodes: {
      Input: { uses: "@core/input", values: { fields: { id: "string", limit: "number" } } },
      Find: { uses: "./nodes/a/find", in: { id: "Input.id", limit: "Input.limit" } },
      Output: { uses: "@core/output", in: { item: "Find.item", id: "Input.id" } },
    },
    view: { Input: { x: 0, y: 0 }, Find: { x: 400, y: 50 }, Output: { x: 800, y: 0 } },
  }
  const caller: WorkflowFile = {
    lorien: 1,
    nodes: {
      Request: { uses: "@core/http-request" },
      Find: { uses: "./nodes/b/other" },
      Lookup: {
        uses: "./nodes/a/lookup",
        in: { id: "Request.params.id" },
        values: { limit: 5 },
        when: "Request.ok",
      },
      Done: { uses: "@core/http-response", in: { body: "Lookup.item.name", id: "Lookup.id" } },
    },
    view: { Lookup: { x: 100, y: 100 } },
  }

  it("renames clashing ids, turns fixed values into values and keeps the condition", () => {
    const out = inlineSubworkflow(caller, "Lookup", sub)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.nodeIds).toEqual(["Find2"])
    expect(out.workflow.nodes.Find2).toEqual({
      uses: "./nodes/a/find",
      in: { id: "Request.params.id" },
      values: { limit: 5 },
      when: "Request.ok",
    })
    expect(out.workflow.nodes.Done?.in).toEqual({
      body: "Find2.item.name",
      id: "Request.params.id",
    })
    expect(out.workflow.view?.Find2).toEqual({ x: 100, y: 100 })
    expect(out.workflow.view?.Lookup).toBeUndefined()
  })

  it("refuses a node whose whole input is one reference", () => {
    const wf = {
      ...caller,
      nodes: { ...caller.nodes, Lookup: { uses: "./nodes/a/lookup", in: "Request" } },
    }
    expect(inlineSubworkflow(wf, "Lookup", sub)).toMatchObject({ ok: false })
  })
})

describe("names", () => {
  it("humanizes ids and slugs names", () => {
    expect(humanize("FindEvent")).toBe("Find event")
    expect(humanize("saveUser")).toBe("Save user")
    expect(slugify("Reserve seats!")).toBe("reserve-seats")
    expect(slugify("  ")).toBe("sub-workflow")
  })
})

describe("subworkflowPathFor", () => {
  it("slugs the name and steps around taken files", () => {
    const taken = new Set(["nodes/orders/reserve.workflow", "nodes/orders/reserve-2.workflow"])
    expect(subworkflowPathFor("Reserve", "orders", (p) => taken.has(p))).toBe(
      "nodes/orders/reserve-3.workflow",
    )
    expect(subworkflowPathFor("Reserve", "nodes/orders/")).toBe("nodes/orders/reserve.workflow")
    expect(subworkflowPathFor("Reserve", " ")).toBe("nodes/shared/reserve.workflow")
  })

  it("keeps the suggested name off an existing node's file", () => {
    const plan = analyzeExtraction(
      route,
      SELECTED,
      schemas,
      "workflows/orders/create.workflow",
      (p) => p === "nodes/events/find-event.workflow",
    )
    expect(plan.name).toBe("Find event flow")
  })
})
