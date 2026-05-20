import { describe, expect, it } from "vitest"
import { apiSlugFromSpec, kebabCase, operationFileName } from "./slug.js"

describe("kebabCase", () => {
  it("camelCase -> kebab", () => {
    expect(kebabCase("getPetById")).toBe("get-pet-by-id")
  })

  it("strips path braces", () => {
    expect(kebabCase("/pets/{petId}")).toBe("pets-petid")
  })

  it("collapses runs", () => {
    expect(kebabCase("get_pet__by__id")).toBe("get-pet-by-id")
  })

  it("trims edges", () => {
    expect(kebabCase("-foo-")).toBe("foo")
  })

  it("empty string", () => {
    expect(kebabCase("")).toBe("")
  })
})

describe("apiSlugFromSpec", () => {
  it("uses title", () => {
    expect(apiSlugFromSpec("Petstore API")).toBe("petstore-api")
  })

  it("falls back to 'api' for empty", () => {
    expect(apiSlugFromSpec("")).toBe("api")
  })
})

describe("operationFileName", () => {
  it("uses operationId when present", () => {
    expect(operationFileName("getPetById", "GET", "/pets/{petId}")).toBe("get-pet-by-id.ts")
  })

  it("falls back to method + path", () => {
    expect(operationFileName(undefined, "GET", "/pets/{petId}")).toBe("get-pets-petid.ts")
  })
})
