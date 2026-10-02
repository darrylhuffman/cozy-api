import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { testWorkflow } from "../testing/test-workflow.js"
import { traceWorkflow } from "../testing/trace-workflow.js"
import {
  flattenedOrigins,
  flattenWorkflow,
  SubworkflowError,
  type SubworkflowMap,
  subworkflowPorts,
} from "./flatten.js"
import { parseWorkflow } from "./parse.js"
import type { WorkflowFile } from "./types.js"
import { validateWorkflow } from "./validate.js"

const EVENTS: Record<string, { id: string; seatsLeft: number; priceCents: number }> = {
  e1: { id: "e1", seatsLeft: 10, priceCents: 500 },
  e2: { id: "e2", seatsLeft: 1, priceCents: 900 },
}

const nodes = {
  "./nodes/events/find-event": defineNode({
    inputs: z.object({ id: z.string() }),
    outputs: z.object({ found: z.boolean(), event: z.any() }),
    async run({ id }) {
      const event = EVENTS[id]
      return { found: Boolean(event), event: event ?? null }
    },
  }),
  "./nodes/orders/check-capacity": defineNode({
    inputs: z.object({ event: z.any(), quantity: z.number() }),
    outputs: z.object({ available: z.boolean(), totalCents: z.number(), error: z.any() }),
    async run({ event, quantity }) {
      const available = event.seatsLeft >= quantity
      return {
        available,
        totalCents: event.priceCents * quantity,
        error: available ? null : { error: "sold out" },
      }
    },
  }),
  "./nodes/orders/create-order": defineNode({
    inputs: z.object({ eventId: z.string(), totalCents: z.number() }),
    outputs: z.object({ order: z.any() }),
    async run({ eventId, totalCents }) {
      return { order: { eventId, totalCents } }
    },
  }),
  "./nodes/hello": defineNode({
    inputs: z.object({}),
    outputs: z.object({ greeting: z.string() }),
    async run() {
      return { greeting: "hi" }
    },
  }),
}

/** Find the event (404) and check capacity (409): the pattern from the design. */
const reserveSeats = parseWorkflow({
  lorien: 1,
  label: "Reserve seats",
  nodes: {
    Input: { uses: "@core/input", values: { fields: { eventId: "string", quantity: "number" } } },
    FindEvent: { uses: "./nodes/events/find-event", in: { id: "Input.eventId" } },
    NoEvent: {
      uses: "@core/response",
      when: "!FindEvent.found",
      values: { status: 404, body: { error: "event not found" } },
    },
    Capacity: {
      uses: "./nodes/orders/check-capacity",
      when: "FindEvent.found",
      in: { event: "FindEvent.event", quantity: "Input.quantity" },
    },
    SoldOut: {
      uses: "@core/response",
      when: "!Capacity.available",
      in: { body: "Capacity.error" },
      values: { status: 409 },
    },
    Output: {
      uses: "@core/output",
      in: {
        event: "FindEvent.event",
        available: "Capacity.available",
        totalCents: "Capacity.totalCents",
      },
    },
  },
})

const subworkflows: SubworkflowMap = {
  "./nodes/orders/reserve-seats": {
    uses: "./nodes/orders/reserve-seats",
    relativePath: "nodes/orders/reserve-seats.workflow",
    file: reserveSeats,
  },
}

const createOrder = parseWorkflow({
  lorien: 1,
  nodes: {
    Request: {
      uses: "@core/http-request",
      values: { path: "/events/:id/orders", method: "POST" },
    },
    ReserveSeats: {
      uses: "./nodes/orders/reserve-seats",
      in: { eventId: "Request.params.id", quantity: "Request.body.quantity" },
    },
    Create: {
      uses: "./nodes/orders/create-order",
      when: "ReserveSeats.available",
      in: { eventId: "ReserveSeats.event.id", totalCents: "ReserveSeats.totalCents" },
    },
    Created: { uses: "@core/response", in: { body: "Create.order" }, values: { status: 201 } },
  },
})

function order(id: string, quantity: number) {
  return testWorkflow(createOrder, {
    request: { params: { id }, body: { quantity } },
    nodes,
    subworkflows,
  })
}

describe("flattenWorkflow", () => {
  it("leaves a workflow without sub-workflows as it is", () => {
    expect(flattenWorkflow(reserveSeats, subworkflows)).toBe(reserveSeats)
  })

  it("inlines the nodes, prefixed with the sub-workflow node's id", () => {
    const flat = flattenWorkflow(createOrder, subworkflows)
    expect(Object.keys(flat.nodes).sort()).toEqual(
      [
        "Create",
        "Created",
        "Request",
        "ReserveSeats__Capacity",
        "ReserveSeats__FindEvent",
        "ReserveSeats__Input",
        "ReserveSeats__NoEvent",
        "ReserveSeats__Output",
        "ReserveSeats__SoldOut",
      ].sort(),
    )
    expect(flat.nodes.ReserveSeats__Input).toEqual({
      uses: "@core/input",
      in: { eventId: "Request.params.id", quantity: "Request.body.quantity" },
    })
    expect(flat.nodes.ReserveSeats__Capacity?.in).toEqual({
      event: "ReserveSeats__FindEvent.event",
      quantity: "ReserveSeats__Input.quantity",
    })
    expect(flat.nodes.ReserveSeats__NoEvent?.when).toBe("!ReserveSeats__FindEvent.found")
    expect(flat.nodes.Create?.when).toBe("ReserveSeats__Output.available")
    expect(flat.nodes.Create?.in).toEqual({
      eventId: "ReserveSeats__Output.event.id",
      totalCents: "ReserveSeats__Output.totalCents",
    })
    expect(validateWorkflow(flat).errors).toEqual([])
  })

  it("runs the happy path through the sub-workflow", async () => {
    const res = await order("e1", 2)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ eventId: "e1", totalCents: 1000 })
  })

  it("lets a Response inside the sub-workflow answer the request", async () => {
    expect((await order("nope", 1)).status).toBe(404)
    const soldOut = await order("e2", 3)
    expect(soldOut.status).toBe(409)
    expect(soldOut.body).toEqual({ error: "sold out" })
  })

  it("traces inner nodes under their flattened ids", async () => {
    const trace = await traceWorkflow(createOrder, {
      request: { params: { id: "e1" }, body: { quantity: 1 } },
      nodes,
      subworkflows,
    })
    expect(trace.at("ReserveSeats__FindEvent").input).toEqual({ id: "e1" })
    expect(trace.at("ReserveSeats__Output").output).toMatchObject({ totalCents: 500 })
  })

  it("gives the node's `when` to its Input and to inner nodes that read nothing", () => {
    const hello = parseWorkflow({
      lorien: 1,
      nodes: {
        Input: { uses: "@core/input", values: { fields: {} } },
        Hello: { uses: "./nodes/hello" },
        Output: { uses: "@core/output", in: { greeting: "Hello.greeting" } },
      },
    })
    const subs: SubworkflowMap = {
      "./nodes/greet": { uses: "./nodes/greet", relativePath: "nodes/greet.workflow", file: hello },
    }
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request", values: { path: "/x", method: "GET" } },
        Greet: { uses: "./nodes/greet", when: "Request.query.loud" },
        Response: { uses: "@core/response", in: { body: "Greet.greeting" } },
      },
    })
    const flat = flattenWorkflow(wf, subs)
    expect(flat.nodes.Greet__Input?.when).toBe("Request.query.loud")
    expect(flat.nodes.Greet__Hello?.when).toBe("Request.query.loud")
  })

  it("skips everything reading the node when it doesn't run", async () => {
    const gated = parseWorkflow({
      ...createOrder,
      nodes: {
        ...createOrder.nodes,
        ReserveSeats: { ...createOrder.nodes.ReserveSeats!, when: "Request.query.go" },
        Skipped: { uses: "@core/response", when: "!Request.query.go", values: { status: 204 } },
      },
    })
    const res = await testWorkflow(gated, {
      request: { params: { id: "e1" }, body: { quantity: 1 } },
      nodes,
      subworkflows,
    })
    expect(res.status).toBe(204)
  })

  it("flattens nested sub-workflows", async () => {
    const outer = parseWorkflow({
      lorien: 1,
      nodes: {
        Input: { uses: "@core/input", values: { fields: { eventId: "string" } } },
        Reserve: {
          uses: "./nodes/orders/reserve-seats",
          in: { eventId: "Input.eventId" },
          values: { quantity: 1 },
        },
        Output: { uses: "@core/output", in: { totalCents: "Reserve.totalCents" } },
      },
    })
    const subs: SubworkflowMap = {
      ...subworkflows,
      "./nodes/orders/one-seat": {
        uses: "./nodes/orders/one-seat",
        relativePath: "nodes/orders/one-seat.workflow",
        file: outer,
      },
    }
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request", values: { path: "/x/:id", method: "GET" } },
        One: { uses: "./nodes/orders/one-seat", in: { eventId: "Request.params.id" } },
        Response: { uses: "@core/response", in: { body: "One.totalCents" } },
      },
    })
    const flat = flattenWorkflow(wf, subs)
    expect(flat.nodes.One__Reserve__FindEvent).toBeDefined()
    const res = await testWorkflow(wf, {
      request: { params: { id: "e2" } },
      nodes,
      subworkflows: subs,
    })
    expect(res.body).toBe(900)
  })

  it("names the loop when a sub-workflow uses itself", () => {
    const loop = parseWorkflow({
      lorien: 1,
      nodes: { Again: { uses: "./nodes/loop" } },
    })
    const subs: SubworkflowMap = {
      "./nodes/loop": { uses: "./nodes/loop", relativePath: "nodes/loop.workflow", file: loop },
    }
    const wf = parseWorkflow({ lorien: 1, nodes: { L: { uses: "./nodes/loop" } } })
    expect(() => flattenWorkflow(wf, subs)).toThrow(
      /uses itself: \.\/nodes\/loop -> \.\/nodes\/loop/,
    )
  })

  it.each([
    [
      "an input the sub-workflow doesn't have",
      { ReserveSeats: { uses: "./nodes/orders/reserve-seats", in: { seats: "Request.body" } } },
      /no input `seats` \(inputs: eventId, quantity\)/,
    ],
    [
      "an output it doesn't have",
      {
        ReserveSeats: { uses: "./nodes/orders/reserve-seats" },
        R: { uses: "@core/response", in: { body: "ReserveSeats.price" } },
      },
      /reads output `price`, but sub-workflow ReserveSeats has no such output \(outputs: event, available, totalCents\)/,
    ],
    [
      "the whole node",
      {
        ReserveSeats: { uses: "./nodes/orders/reserve-seats" },
        R: { uses: "@core/response", in: { body: "ReserveSeats" } },
      },
      /read one of ReserveSeats's outputs/,
    ],
    [
      "a clashing id",
      {
        ReserveSeats: { uses: "./nodes/orders/reserve-seats" },
        ReserveSeats__FindEvent: { uses: "./nodes/hello" },
      },
      /clashes with a node from sub-workflow/,
    ],
  ])("refuses %s", (_label, extra, message) => {
    const wf: WorkflowFile = parseWorkflow({
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request", values: { path: "/x", method: "POST" } },
        ...extra,
      },
    })
    expect(() => flattenWorkflow(wf, subworkflows)).toThrow(SubworkflowError)
    expect(() => flattenWorkflow(wf, subworkflows)).toThrow(message)
  })
})

describe("subworkflowPorts", () => {
  it("reads inputs from the Input's fields and outputs from the Output's wiring", () => {
    expect(subworkflowPorts(reserveSeats)).toEqual({
      inputId: "Input",
      outputId: "Output",
      inputs: { eventId: "string", quantity: "number" },
      outputs: ["event", "available", "totalCents"],
    })
  })
})

describe("flattenedOrigins", () => {
  it("says which file and node each flattened node came from", () => {
    const origins = flattenedOrigins(createOrder, "workflows/orders/create.workflow", subworkflows)
    const flat = flattenWorkflow(createOrder, subworkflows)
    expect(Object.keys(origins).sort()).toEqual(
      Object.keys(flat.nodes)
        .filter((id) => id.startsWith("ReserveSeats__"))
        .sort(),
    )
    expect(origins.ReserveSeats__FindEvent).toEqual({
      frames: [
        { workflowPath: "workflows/orders/create.workflow", nodeId: "ReserveSeats" },
        { workflowPath: "nodes/orders/reserve-seats.workflow", nodeId: "FindEvent" },
      ],
    })
    expect(origins.ReserveSeats__Input?.role).toBe("input")
    expect(origins.ReserveSeats__Output?.role).toBe("output")
    expect(origins.Request).toBeUndefined()
  })

  it("lists every level of a nested sub-workflow", () => {
    const outer: SubworkflowMap = {
      ...subworkflows,
      "./nodes/orders/outer": {
        uses: "./nodes/orders/outer",
        relativePath: "nodes/orders/outer.workflow",
        file: parseWorkflow({
          lorien: 1,
          nodes: {
            Input: { uses: "@core/input", values: { fields: { eventId: "string" } } },
            Seats: { uses: "./nodes/orders/reserve-seats", in: { eventId: "Input.eventId" } },
          },
        }),
      },
    }
    const wf = parseWorkflow({ lorien: 1, nodes: { Wrap: { uses: "./nodes/orders/outer" } } })
    const origins = flattenedOrigins(wf, "workflows/w.workflow", outer)
    expect(origins.Wrap__Seats__FindEvent?.frames.map((f) => f.nodeId)).toEqual([
      "Wrap",
      "Seats",
      "FindEvent",
    ])
    expect(Object.keys(origins)).toContain("Wrap__Seats__Input")
  })
})

describe("mocks inside a sub-workflow", () => {
  it("stand in for an inner node by its flattened id", async () => {
    const result = await testWorkflow(createOrder, {
      request: { params: { id: "nope" }, body: { quantity: 1 } },
      nodes,
      subworkflows,
      mocks: {
        ReserveSeats__FindEvent: {
          output: { found: true, event: { id: "mocked", seatsLeft: 5, priceCents: 100 } },
        },
      },
    })
    expect(result.status).toBe(201)
    expect(result.body).toEqual({ eventId: "mocked", totalCents: 100 })
  })
})
