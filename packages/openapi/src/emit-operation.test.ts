import { describe, expect, it } from "vitest"
import { emitOperationNode, OPENAPI_GENERATED_MARKER } from "./emit-operation.js"
import type { OpenAPIObject } from "./load-spec.js"

function spec(): OpenAPIObject {
  return { openapi: "3.0.0", info: { title: "t", version: "1" }, paths: {} } as OpenAPIObject
}

describe("emitOperationNode", () => {
  it("emits a defineNode with header marker and imports", () => {
    const { source } = emitOperationNode(
      spec(),
      { operationId: "getPet", responses: { "200": { description: "ok" } } } as never,
      "/pets/{petId}",
      "get",
    )
    expect(source).toContain(OPENAPI_GENERATED_MARKER)
    expect(source).toContain(`import { defineNode } from "@darrylondil/lorien-runtime"`)
    expect(source).toContain(`import { z } from "zod"`)
    expect(source).toContain(`import { baseUrl, buildHeaders } from "./_client.js"`)
    expect(source).toContain(`export default defineNode(`)
  })

  it("includes pathParams in inputs when path has parameters", () => {
    const { source } = emitOperationNode(
      spec(),
      {
        operationId: "getPet",
        parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "ok" } },
      } as never,
      "/pets/{petId}",
      "get",
    )
    expect(source).toMatch(/pathParams:\s*z\.object\(\{/)
    expect(source).toMatch(/"petId":\s*z\.string\(\)/)
  })

  it("includes query, headers, and body when provided", () => {
    const { source } = emitOperationNode(
      spec(),
      {
        operationId: "createPet",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "x-trace", in: "header", schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
            },
          },
        },
        responses: { "201": { description: "ok" } },
      } as never,
      "/pets",
      "post",
    )
    expect(source).toMatch(/query:\s*z\.object/)
    expect(source).toMatch(/headers:\s*z\.object/)
    expect(source).toMatch(/body:\s*z\.object/)
    expect(source).toMatch(/JSON\.stringify\(input\.body\)/)
  })

  it("emits z.unknown() for the response when no 2xx schema", () => {
    const { source } = emitOperationNode(
      spec(),
      { operationId: "ping", responses: { "200": { description: "ok" } } } as never,
      "/ping",
      "get",
    )
    expect(source).toMatch(/outputs:\s*z\.object\(\{ data:\s*z\.unknown\(\)/)
  })

  it("uses operation summary as the friendly name when present", () => {
    const { source } = emitOperationNode(
      spec(),
      { summary: "Get Pet by ID", operationId: "getPet", responses: {} } as never,
      "/pets/{id}",
      "get",
    )
    expect(source).toContain(`name: "Get Pet by ID"`)
  })
})
