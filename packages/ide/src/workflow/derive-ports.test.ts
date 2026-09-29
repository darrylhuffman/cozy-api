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

/** Leaf inferred from references (legacy top-level inference marks these). */
const inferredLeaf = (name: string) => ({
  id: name,
  label: name,
  children: [],
  isLeaf: true,
  inferred: true,
})

/** Empty root input port (no children — leaf). */
const emptyRoot = { id: "", label: "input", children: [], isLeaf: true }

/** Root branch input port wrapping the given children. */
const rootBranch = (children: ReturnType<typeof leaf>[]) => ({
  id: "",
  label: "input",
  children,
  isLeaf: false,
})

describe("derivePorts (no schemas — legacy reference inference)", () => {
  it("returns empty inputs and outputs for a standalone trigger node", () => {
    const wf = baseWorkflow({
      request: { uses: "@core/http-request" },
    })
    const ports = derivePorts(wf)
    expect(ports.get("request")).toEqual({ inputs: emptyRoot, outputs: [] })
  })

  it("returns inputs from the node's in: block keys", () => {
    const wf = baseWorkflow({
      save: { uses: "./nodes/save", in: { email: "x", password: "y" } },
    })
    const ports = derivePorts(wf)
    const savePorts = ports.get("save")!
    expect(savePorts.inputs).toEqual(rootBranch([leaf("email"), leaf("password")]))
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
    expect(ports.get("request")!.outputs).toEqual([inferredLeaf("body")])
    expect(ports.get("save")!.inputs).toEqual(rootBranch([leaf("body")]))
  })

  it("nested references grow the source's output tree with inferred children", () => {
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
    const requestOutputs = ports.get("request")!.outputs
    expect(requestOutputs).toHaveLength(1)
    const body = requestOutputs[0]!
    expect(body.id).toBe("body")
    expect(body.isLeaf).toBe(false)
    expect(body.inferred).toBe(true)
    expect(body.children.map((c) => c.id).sort()).toEqual([
      "body.email",
      "body.password",
    ])
    for (const child of body.children) {
      expect(child.inferred).toBe(true)
      expect(child.isLeaf).toBe(true)
    }
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

  it("legacy top-level inference marks ports as inferred", () => {
    const wf = baseWorkflow({
      request: { uses: "@core/http-request" },
      save: { uses: "./nodes/save", in: { body: "request.body" } },
    })
    const ports = derivePorts(wf)
    expect(ports.get("request")!.outputs[0]!.inferred).toBe(true)
  })

  it("literal values in values: blocks do not create output ports", () => {
    const wf = baseWorkflow({
      request: { uses: "@core/http-request" },
      response: {
        uses: "@core/response",
        in: { body: "request.body" },
        values: { status: 201 },
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
    expect(ports.get("a")!.outputs).toEqual([inferredLeaf("out")])
  })

  it("references to unknown nodes are skipped", () => {
    const wf = baseWorkflow({
      b: { uses: "@core/transform", in: { input: "nonexistent.value" } },
    })
    const ports = derivePorts(wf)
    expect(ports.get("b")!.inputs).toEqual(rootBranch([leaf("input")]))
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
        values: { path: "/users", method: "POST" },
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
        in: { body: "save.user" },
        values: { status: 201 },
      },
    })
    const ports = derivePorts(wf)

    const requestPorts = ports.get("request")!
    // Without schemas, the inputs root is inferred from `values:` keys (the
    // legacy fallback path). The trigger semantically takes no inputs, but
    // without schema information the fallback can only see what's there.
    // In production, CORE_SCHEMAS dictates that http-request has no input root.
    expect(requestPorts.inputs).toEqual(rootBranch([leaf("path"), leaf("method")]))
    // body is promoted to a branch by nested inference because `save` refers
    // into request.body.email / request.body.password.
    expect(requestPorts.outputs).toHaveLength(1)
    const body = requestPorts.outputs[0]!
    expect(body.id).toBe("body")
    expect(body.inferred).toBe(true)
    expect(body.isLeaf).toBe(false)
    expect(body.children.map((c) => c.id).sort()).toEqual([
      "body.email",
      "body.password",
    ])

    const savePorts = ports.get("save")!
    expect(savePorts.inputs).toEqual(rootBranch([leaf("email"), leaf("password")]))
    expect(savePorts.outputs).toEqual([inferredLeaf("user")])

    const responsePorts = ports.get("response")!
    expect(responsePorts.inputs).toEqual(rootBranch([leaf("body"), leaf("status")]))
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
    const inputs = ports.get("save")!.inputs
    expect(inputs.id).toBe("")
    expect(inputs.isLeaf).toBe(false)
    const inputIds = inputs.children.map((p) => p.id).sort()
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

  it("regression: save's output port persists after all downstream refs are removed", () => {
    // Reproduces the bug where disconnecting the only consumer of `save.user`
    // would cause the schema-derived "user" output port to disappear. The
    // schema is the source of truth — outputs must remain regardless of
    // reference inference.
    const wf = baseWorkflow({
      request: {
        uses: "@core/http-request",
        values: { path: "/users", method: "POST" },
      },
      save: {
        uses: "./nodes/users/save-user",
        in: {
          email: "request.body.email",
          password: "request.body.password",
        },
      },
      // No `response` node and no other node references `save.user`. The
      // legacy reference-inference path would yield zero outputs; the schema
      // path must still produce the "user" port.
    })
    const ports = derivePorts(wf, schemas)
    const userPort = ports.get("save")!.outputs.find((p) => p.id === "user")
    expect(userPort).toBeDefined()
    expect(userPort?.isLeaf).toBe(false)
  })

  it("string-form `in:` infers a single output port on the source", () => {
    // Without schemas, a whole-object reference like `request.body` should
    // still create the corresponding output port on the source node.
    const wf = baseWorkflow({
      request: { uses: "@core/http-request" },
      save: { uses: "./nodes/save", in: "request.body" },
    })
    const ports = derivePorts(wf, {})
    expect(ports.get("request")!.outputs).toEqual([inferredLeaf("body")])
    // The save node's input — no schema, no per-field keys → empty leaf root.
    expect(ports.get("save")!.inputs).toEqual(emptyRoot)
  })

  it("string-form `in:` with schema gives a root branch + output port inferred", () => {
    const wf = baseWorkflow({
      request: { uses: "@core/http-request" },
      save: { uses: "./nodes/users/save-user", in: "request.body" },
    })
    const ports = derivePorts(wf, schemas)
    expect(ports.get("request")!.outputs).toEqual([inferredLeaf("body")])
    const inputs = ports.get("save")!.inputs
    expect(inputs.id).toBe("")
    expect(inputs.isLeaf).toBe(false)
    expect(inputs.children.map((c) => c.id).sort()).toEqual(["email", "password"])
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
    expect(ports.get("request")!.outputs).toEqual([inferredLeaf("body")])
  })

  it("@core/http-request: body output present when method is POST", () => {
    const httpSchemas: Record<string, NodeSchemas> = {
      "@core/http-request": {
        inputs: {
          type: "object",
          properties: {
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
            path: { type: "string" },
          },
        },
        outputs: {
          type: "object",
          properties: {
            body: { type: "object" },
            headers: { type: "object" },
          },
        },
      },
    }
    const wf = baseWorkflow({
      req: { uses: "@core/http-request", values: { method: "POST", path: "/users" } },
    })
    const ports = derivePorts(wf, httpSchemas)
    const outputIds = ports.get("req")!.outputs.map((p) => p.id)
    expect(outputIds).toContain("body")
  })

  it("@core/http-request: body output hidden when method is GET (from values:)", () => {
    const httpSchemas: Record<string, NodeSchemas> = {
      "@core/http-request": {
        inputs: {
          type: "object",
          properties: {
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
            path: { type: "string" },
          },
        },
        outputs: {
          type: "object",
          properties: {
            body: { type: "object" },
            headers: { type: "object" },
          },
        },
      },
    }
    const wf = baseWorkflow({
      req: { uses: "@core/http-request", values: { method: "GET", path: "/users" } },
    })
    const ports = derivePorts(wf, httpSchemas)
    const outputIds = ports.get("req")!.outputs.map((p) => p.id)
    expect(outputIds).not.toContain("body")
    expect(outputIds).toContain("headers")
  })

  it("@core/http-request: body output hidden when method is DELETE (from values:)", () => {
    const httpSchemas: Record<string, NodeSchemas> = {
      "@core/http-request": {
        inputs: {
          type: "object",
          properties: {
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
            path: { type: "string" },
          },
        },
        outputs: {
          type: "object",
          properties: {
            body: { type: "object" },
            headers: { type: "object" },
          },
        },
      },
    }
    const wf = baseWorkflow({
      req: { uses: "@core/http-request", values: { method: "DELETE", path: "/users/1" } },
    })
    const ports = derivePorts(wf, httpSchemas)
    const outputIds = ports.get("req")!.outputs.map((p) => p.id)
    expect(outputIds).not.toContain("body")
  })

  it("promotes a schema-declared opaque body leaf when a reference reaches into it", () => {
    // @core/http-request declares body as { type: "object" } with no properties,
    // so schemaToTree treats it as a leaf. A reference like
    // request.body.email should promote that leaf to a branch with inferred
    // children email / password, and mark them all inferred.
    const httpSchemas: Record<string, NodeSchemas> = {
      "@core/http-request": {
        inputs: { type: "object", properties: {} },
        outputs: {
          type: "object",
          properties: {
            body: { type: "object" },
          },
        },
      },
    }
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
    const ports = derivePorts(wf, httpSchemas)
    const body = ports.get("request")!.outputs.find((p) => p.id === "body")!
    expect(body.isLeaf).toBe(false)
    expect(body.inferred).toBe(true)
    expect(body.schema).toBeUndefined() // schema dropped on promotion
    expect(body.children.map((c) => c.id).sort()).toEqual([
      "body.email",
      "body.password",
    ])
    for (const child of body.children) {
      expect(child.inferred).toBe(true)
    }
  })

  it("leaves typed primitive leaves alone (no promotion)", () => {
    // If the schema declares a property as a string, a reference that drills
    // into it (e.g. user.name.first when name is a string) is a workflow bug,
    // not a hint. The string leaf must remain a leaf.
    const primSchemas: Record<string, NodeSchemas> = {
      "@core/produce": {
        inputs: { type: "object", properties: {} },
        outputs: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      },
    }
    const wf = baseWorkflow({
      a: { uses: "@core/produce" },
      b: { uses: "./consume", in: { x: "a.name.first" } },
    })
    const ports = derivePorts(wf, primSchemas)
    const name = ports.get("a")!.outputs.find((p) => p.id === "name")!
    expect(name.isLeaf).toBe(true)
    expect(name.children).toEqual([])
  })

  it("does not duplicate or shadow schema-declared nested children", () => {
    // body.user.email is declared by the schema. A reference to it should be
    // a no-op for the port tree.
    const wf = baseWorkflow({
      save: { uses: "./nodes/users/save-user" },
      consume: { uses: "./consume", in: { x: "save.user.email" } },
    })
    const ports = derivePorts(wf, schemas)
    const user = ports.get("save")!.outputs.find((p) => p.id === "user")!
    expect(user.inferred).toBeUndefined() // still schema-declared
    const email = user.children.find((c) => c.id === "user.email")!
    expect(email.inferred).toBeUndefined()
    expect(user.children).toHaveLength(2) // id and email — no duplicates
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
