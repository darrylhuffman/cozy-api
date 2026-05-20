import { describe, expect, it } from "vitest"
import { convertOpenApiSpec } from "./convert.js"
import type { OpenAPIObject } from "./load-spec.js"

function petstoreSpec(): OpenAPIObject {
  return {
    openapi: "3.0.0",
    info: { title: "Petstore API", version: "1.0" },
    paths: {
      "/pets": {
        get: {
          operationId: "listPets",
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        post: {
          operationId: "addPet",
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
        },
      },
      "/pets/{petId}": {
        get: {
          operationId: "getPetById",
          parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" } },
        },
      },
    },
  } as OpenAPIObject
}

describe("convertOpenApiSpec", () => {
  it("derives the api slug from spec.info.title", () => {
    const result = convertOpenApiSpec(petstoreSpec())
    expect(result.apiSlug).toBe("petstore-api")
  })

  it("emits one file per operation + _client.ts", () => {
    const result = convertOpenApiSpec(petstoreSpec())
    const names = result.files.map((f) => f.relativePath)
    expect(names).toContain("list-pets.ts")
    expect(names).toContain("add-pet.ts")
    expect(names).toContain("get-pet-by-id.ts")
    expect(names).toContain("_client.ts")
    expect(result.files).toHaveLength(4)
  })

  it("each operation file contains the cozy-openapi marker", () => {
    const result = convertOpenApiSpec(petstoreSpec())
    for (const f of result.files) {
      if (f.relativePath === "_client.ts") continue
      expect(f.source).toMatch(/cozy-openapi: generated/)
    }
  })

  it("accepts apiSlug override", () => {
    const result = convertOpenApiSpec(petstoreSpec(), { apiSlug: "custom" })
    expect(result.apiSlug).toBe("custom")
  })

  it("includes warnings from schemaToZod when relevant", () => {
    const buggy: OpenAPIObject = {
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: {
        "/x": {
          get: {
            operationId: "x",
            responses: {
              "200": {
                description: "x",
                content: {
                  "application/json": { schema: { allOf: [{ type: "object" }] } },
                },
              },
            },
          },
        },
      },
    } as OpenAPIObject
    const result = convertOpenApiSpec(buggy)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toMatch(/composition/i)
  })
})
