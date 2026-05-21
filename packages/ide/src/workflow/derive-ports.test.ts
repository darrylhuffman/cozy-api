import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { derivePorts } from "./derive-ports.js"

const baseWorkflow = (nodes: WorkflowFile["nodes"]): WorkflowFile => ({
  lorien: 1,
  nodes,
})

describe("derivePorts", () => {
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
    expect(savePorts.inputs).toEqual([
      { id: "email", label: "email" },
      { id: "password", label: "password" },
    ])
  })

  it("no outputs when nobody references the node", () => {
    const wf = baseWorkflow({
      a: { uses: "@core/http-request" },
      b: { uses: "./nodes/save", in: { email: "a.body.email" } },
    })
    const ports = derivePorts(wf)
    // b references a, so a gets output "body"
    expect(ports.get("b")!.outputs).toEqual([])
  })

  it("two-node chain — source gets output port, dest gets input port", () => {
    const wf = baseWorkflow({
      request: { uses: "@core/http-request" },
      save: { uses: "./nodes/save", in: { body: "request.body" } },
    })
    const ports = derivePorts(wf)
    expect(ports.get("request")!.outputs).toEqual([{ id: "body", label: "body" }])
    expect(ports.get("save")!.inputs).toEqual([{ id: "body", label: "body" }])
  })

  it("deduplicates output ports when multiple fields reference the same source port", () => {
    // request.body.email and request.body.password → both reference port "body" on request
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
    const requestPorts = ports.get("request")!
    expect(requestPorts.outputs).toHaveLength(1)
    expect(requestPorts.outputs[0]).toEqual({ id: "body", label: "body" })
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
          status: 201, // numeric literal — must not cause a port
        },
      },
    })
    const ports = derivePorts(wf)
    // status: 201 is not a string reference — no port created for it
    expect(ports.get("request")!.outputs).toHaveLength(1)
    expect(ports.get("request")!.outputs[0]!.id).toBe("body")
  })

  it("bare nodeId reference (no path) produces 'out' port", () => {
    const wf = baseWorkflow({
      a: { uses: "@core/http-request" },
      b: { uses: "@core/transform", in: { input: "a" } },
    })
    const ports = derivePorts(wf)
    expect(ports.get("a")!.outputs).toEqual([{ id: "out", label: "out" }])
  })

  it("references to unknown nodes are skipped", () => {
    const wf = baseWorkflow({
      b: { uses: "@core/transform", in: { input: "nonexistent.value" } },
    })
    const ports = derivePorts(wf)
    expect(ports.get("b")!.inputs).toEqual([{ id: "input", label: "input" }])
    // nonexistent node has no entry in result
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

    // request: trigger — no inputs; output port "body" (referenced by save)
    const requestPorts = ports.get("request")!
    expect(requestPorts.inputs).toEqual([])
    expect(requestPorts.outputs).toEqual([{ id: "body", label: "body" }])

    // save: inputs email + password; output port "user" (referenced by response)
    const savePorts = ports.get("save")!
    expect(savePorts.inputs).toEqual([
      { id: "email", label: "email" },
      { id: "password", label: "password" },
    ])
    expect(savePorts.outputs).toEqual([{ id: "user", label: "user" }])

    // response: inputs body + status (status:201 is a literal, but status IS a key in in:)
    // Input ports come from keys of in:, not from values — so status IS an input port
    const responsePorts = ports.get("response")!
    expect(responsePorts.inputs).toEqual([
      { id: "body", label: "body" },
      { id: "status", label: "status" },
    ])
    expect(responsePorts.outputs).toEqual([])
  })
})
