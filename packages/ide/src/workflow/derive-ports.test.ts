import { describe, expect, it } from "vitest"
import type { NodeSchemas, WorkflowFile } from "@/lib/api"
import { derivePorts } from "./derive-ports.js"

const baseWorkflow = (nodes: WorkflowFile["nodes"]): WorkflowFile => ({
  lorien: 1,
  nodes,
})

/** Convenience: build a leaf port for matchers. */
const leaf = (name: string) => ({
  id: name,
  label: name,
  children: [],
  isLeaf: true,
})

describe("derivePorts (no schemas — legacy reference inference)", () => {
  it("returns empty inputs and outputs for a standalone trigger node", () => {
    const wf = baseWorkflow({
      request: { uses: "@core/http-request" },
    })
    const ports = derivePorts(wf)
    expect(ports.get("request")).toEqual({ inputs: [], outputs: [] })
  })

  it("returns inputs from the node's in: block keys", () => {
    const wf = baseWorkflow({
      save: { uses: "./nodes/save", in: { email: "x", password: "y" } },
    })
    const ports = derivePorts(wf)
    const savePorts = ports.get("save")!
    expect(savePorts.inputs).toEqual([leaf("email"), leaf("password")])
  })

  it("no outputs when nobody references the node", () => {
    const wf = baseWorkflow({
      a: { uses: "@core/http-request" },
      b: { uses: "./nodes/save", in: { email: "a.body.email" } },
    })
    const ports = derivePorts(wf)
    expect(ports.get("b")!.outputs).toEqual([])
  })

  it("two-node chain — source gets output port, dest gets input port", () => {
    const wf = baseWorkflow({
      request: { uses: "@core/http-request" },
      save: { uses: "./nodes/save", in: { body: "request.body" } },
    })
    const ports = derivePorts(wf)
    expect(ports.get("request")!.outputs).toEqual([leaf("body")])
    expect(ports.get("save")!.inputs).toEqual([leaf("body")])
  })

  it("deduplicates output ports when multiple fields reference the same source port", () => {
    const wf = baseWorkflow({
      request: { uses: "@core/http-request" },
      save: {
        uses: "./nodes/save",
        in: {
          email: "request.body.email",
          password: "request.body.password",
        },
      },
    })
    const ports = derivePorts(wf)
    expect(ports.get("request")!.outputs).toHaveLength(1)
    expect(ports.get("request")!.outputs[0]).toEqual(leaf("body"))
  })

  it("creates distinct output ports for different first segments", () => {
    const wf = baseWorkflow({
      src: { uses: "@core/http-request" },
      a: { uses: "./nodeA", in: { x: "src.headers" } },
      b: { uses: "./nodeB", in: { y: "src.body" } },
    })
    const ports = derivePorts(wf)
    const srcPorts = ports.get("src")!
    expect(srcPorts.outputs).toHaveLength(2)
    const ids = srcPorts.outputs.map((p) => p.id).sort()
    expect(ids).toEqual(["body", "headers"])
  })

  it("literal values in in: blocks do not create output ports", () => {
    const wf = baseWorkflow({
      request: { uses: "@core/http-request" },
      response: {
        uses: "@core/response",
        in: {
          body: "request.body",
          status: 201,
        },
      },
    })
    const ports = derivePorts(wf)
    expect(ports.get("request")!.outputs).toHaveLength(1)
    expect(ports.get("request")!.outputs[0]!.id).toBe("body")
  })

  it("bare nodeId reference (no path) produces 'out' port", () => {
    const wf = baseWorkflow({
      a: { uses: "@core/http-request" },
      b: { uses: "@core/transform", in: { input: "a" } },
    })
    const ports = derivePorts(wf)
    expect(ports.get("a")!.outputs).toEqual([leaf("out")])
  })

  it("references to unknown nodes are skipped", () => {
    const wf = baseWorkflow({
      b: { uses: "@core/transform", in: { input: "nonexistent.value" } },
    })
    const ports = derivePorts(wf)
    expect(ports.get("b")!.inputs).toEqual([leaf("input")])
    expect(ports.has("nonexistent")).toBe(false)
  })

  it("terminal node (@core/response) gets no outputs", () => {
    const wf = baseWorkflow({
      save: { uses: "./nodes/save" },
      response: { uses: "@core/response", in: { body: "save.user" } },
    })
    const ports = derivePorts(wf)
    expect(ports.get("response")!.outputs).toEqual([])
  })

  it("full basic-api create.workflow scenario", () => {
    const wf = baseWorkflow({
      request: {
        uses: "@core/http-request",
        config: { path: "/users", method: "POST" },
      },
      save: {
        uses: "./nodes/users/save-user",
        in: {
          email: "request.body.email",
          password: "request.body.password",
        },
      },
      response: {
        uses: "@core/response",
        in: {
          body: "save.user",
          status: 201,
        },
      },
    })
    const ports = derivePorts(wf)

    const requestPorts = ports.get("request")!
    expect(requestPorts.inputs).toEqual([])
    expect(requestPorts.outputs).toEqual([leaf("body")])

    const savePorts = ports.get("save")!
    expect(savePorts.inputs).toEqual([leaf("email"), leaf("password")])
    expect(savePorts.outputs).toEqual([leaf("user")])

    const responsePorts = ports.get("response")!
    expect(responsePorts.inputs).toEqual([leaf("body"), leaf("status")])
    expect(responsePorts.outputs).toEqual([])
  })
})

describe("derivePorts (with schemas)", () => {
  const schemas: Record<string, NodeSchemas> = {
    "./nodes/users/save-user": {
      inputs: {
        type: "object",
        properties: {
          email: { type: "string" },
          password: { type: "string" },
        },
      },
      outputs: {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              id: { type: "string" },
              email: { type: "string" },
            },
          },
        },
      },
    },
  }

  it("uses schema inputs as truth, ignoring keys of in: block", () => {
    const wf = baseWorkflow({
      save: {
        uses: "./nodes/users/save-user",
        in: { email: "x", password: "y", unknown_extra: "z" },
      },
    })
    const ports = derivePorts(wf, schemas)
    const inputIds = ports
      .get("save")!
      .inputs.map((p) => p.id)
      .sort()
    expect(inputIds).toEqual(["email", "password"])
  })

  it("uses schema outputs as truth — even when no other node references the port", () => {
    const wf = baseWorkflow({
      save: { uses: "./nodes/users/save-user", in: {} },
    })
    const ports = derivePorts(wf, schemas)
    const savePorts = ports.get("save")!
    expect(savePorts.outputs).toHaveLength(1)
    expect(savePorts.outputs[0]!.id).toBe("user")
    expect(savePorts.outputs[0]!.isLeaf).toBe(false)
    // The "user" port expands into id + email
    const childrenIds = savePorts.outputs[0]!.children.map((c) => c.id).sort()
    expect(childrenIds).toEqual(["user.email", "user.id"])
  })

  it("falls back to reference-inference when the schema is absent", () => {
    const wf = baseWorkflow({
      request: { uses: "@core/http-request" },
      save: {
        uses: "./unknown-without-schema",
        in: { body: "request.body" },
      },
    })
    const ports = derivePorts(wf, {})
    expect(ports.get("request")!.outputs).toEqual([leaf("body")])
  })

  it("nested object → branch with children at every level", () => {
    const deepSchemas: Record<string, NodeSchemas> = {
      "@core/http-request": {
        inputs: { type: "object", properties: {} },
        outputs: {
          type: "object",
          properties: {
            body: {
              type: "object",
              properties: {
                user: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    }
    const wf = baseWorkflow({
      request: { uses: "@core/http-request" },
    })
    const ports = derivePorts(wf, deepSchemas)
    const out = ports.get("request")!.outputs
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe("body")
    expect(out[0]!.children[0]!.id).toBe("body.user")
    expect(out[0]!.children[0]!.children[0]!.id).toBe("body.user.name")
    expect(out[0]!.children[0]!.children[0]!.isLeaf).toBe(true)
  })
})
