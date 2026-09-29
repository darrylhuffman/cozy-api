import { describe, expect, it } from "vitest"
import { discoverTriggerConsumers } from "./discover-trigger-consumers"
import type { NodeSchemas, WorkflowFile } from "@/lib/api"

const saveUserSchema: NodeSchemas = {
  inputs: {
    type: "object",
    properties: {
      email: { type: "string" },
      password: { type: "string" },
    },
  },
  outputs: { type: "object", properties: { user: { type: "object" } } },
}

const echoSchema: NodeSchemas = {
  inputs: {
    type: "object",
    properties: {
      msg: { type: "string" },
    },
  },
  outputs: { type: "object", properties: { msg: { type: "string" } } },
}

describe("discoverTriggerConsumers", () => {
  it("per-field references: builds an object schema from consumer field schemas", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        SaveUser: {
          uses: "./nodes/save-user",
          in: {
            email: "Request.body.email",
            password: "Request.body.password",
          },
        },
      },
    }
    const schemas = { "./nodes/save-user": saveUserSchema }
    const result = discoverTriggerConsumers(workflow, "Request", schemas)
    expect(result.body).toEqual({
      type: "object",
      properties: {
        email: { type: "string" },
        password: { type: "string" },
      },
    })
    expect(result.query).toBeNull()
    expect(result.headers).toBeNull()
  })

  it("whole-object reference: uses the consumer's full inputs schema", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        Echo: {
          uses: "./nodes/echo",
          in: "Request.body",
        },
      },
    }
    const schemas = { "./nodes/echo": echoSchema }
    const result = discoverTriggerConsumers(workflow, "Request", schemas)
    expect(result.body).toEqual(echoSchema.inputs)
  })

  it("multiple per-field consumers merge their properties", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        SaveUser: {
          uses: "./nodes/save-user",
          in: { email: "Request.body.email" },
        },
        SaveProfile: {
          uses: "./nodes/save-profile",
          in: { displayName: "Request.body.name" },
        },
      },
    }
    const schemas: Record<string, NodeSchemas> = {
      "./nodes/save-user": saveUserSchema,
      "./nodes/save-profile": {
        inputs: { type: "object", properties: { displayName: { type: "string" } } },
        outputs: { type: "object" },
      },
    }
    const result = discoverTriggerConsumers(workflow, "Request", schemas)
    expect(result.body?.properties).toEqual({
      email: { type: "string" },
      name: { type: "string" },
    })
  })

  it("query and headers populate from their respective categories", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        Search: {
          uses: "./nodes/search",
          in: {
            q: "Request.query.q",
            limit: "Request.query.limit",
            auth: "Request.headers.authorization",
          },
        },
      },
    }
    const searchSchema: NodeSchemas = {
      inputs: {
        type: "object",
        properties: {
          q: { type: "string" },
          limit: { type: "integer" },
          auth: { type: "string" },
        },
      },
      outputs: { type: "object" },
    }
    const result = discoverTriggerConsumers(workflow, "Request", {
      "./nodes/search": searchSchema,
    })
    expect(result.query?.properties).toEqual({
      q: { type: "string" },
      limit: { type: "integer" },
    })
    expect(result.headers?.properties).toEqual({
      authorization: { type: "string" },
    })
    expect(result.body).toBeNull()
  })

  it("references to a different trigger output are ignored", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        OtherTrigger: { uses: "@core/http-request" },
        Reader: {
          uses: "./nodes/reader",
          in: { msg: "OtherTrigger.body.msg" },
        },
      },
    }
    const readerSchema: NodeSchemas = {
      inputs: { type: "object", properties: { msg: { type: "string" } } },
      outputs: { type: "object" },
    }
    const result = discoverTriggerConsumers(workflow, "Request", {
      "./nodes/reader": readerSchema,
    })
    expect(result.body).toBeNull()
    expect(result.query).toBeNull()
    expect(result.headers).toBeNull()
  })

  it("missing consumer schema → consumer is silently skipped", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        Mystery: {
          uses: "./nodes/mystery",
          in: { x: "Request.body.x" },
        },
      },
    }
    const result = discoverTriggerConsumers(workflow, "Request", {})
    expect(result.body).toBeNull()
  })

  it("deeper-than-3 references are skipped (v1 limitation)", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        Reader: {
          uses: "./nodes/reader",
          in: { name: "Request.body.user.name" },
        },
      },
    }
    const readerSchema: NodeSchemas = {
      inputs: { type: "object", properties: { name: { type: "string" } } },
      outputs: { type: "object" },
    }
    const result = discoverTriggerConsumers(workflow, "Request", {
      "./nodes/reader": readerSchema,
    })
    expect(result.body).toBeNull()
  })

  it("workflow where nothing references the trigger → all null", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        Isolated: { uses: "./nodes/isolated" },
      },
    }
    const result = discoverTriggerConsumers(workflow, "Request", {})
    expect(result).toEqual({ body: null, query: null, headers: null })
  })

  it("first-writer-wins on property conflict", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        A: {
          uses: "./nodes/a",
          in: { email: "Request.body.email" },
        },
        B: {
          uses: "./nodes/b",
          in: { email: "Request.body.email" },
        },
      },
    }
    const schemas: Record<string, NodeSchemas> = {
      "./nodes/a": {
        inputs: { type: "object", properties: { email: { type: "string" } } },
        outputs: { type: "object" },
      },
      "./nodes/b": {
        inputs: { type: "object", properties: { email: { type: "integer" } } },
        outputs: { type: "object" },
      },
    }
    const result = discoverTriggerConsumers(workflow, "Request", schemas)
    // First consumer (A) wins; email stays type string
    expect(result.body?.properties?.email).toEqual({ type: "string" })
  })

  it("empty workflow → all null", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {},
    }
    const result = discoverTriggerConsumers(workflow, "Request", {})
    expect(result).toEqual({ body: null, query: null, headers: null })
  })
})
