import { describe, expect, it } from "vitest"
import { deriveWorkflowPath, expandTemplate } from "./template.js"

describe("deriveWorkflowPath", () => {
  it("strips crud verb and returns parent segments", () => {
    expect(deriveWorkflowPath("workflows/users/create.workflow")).toBe("/users")
  })

  it("strips list verb from posts workflow", () => {
    expect(deriveWorkflowPath("workflows/posts/list.workflow")).toBe("/posts")
  })

  it("returns the single segment for a top-level workflow", () => {
    expect(deriveWorkflowPath("workflows/health.workflow")).toBe("/health")
  })

  it("preserves multi-segment paths, dropping only the final crud verb", () => {
    expect(deriveWorkflowPath("workflows/admin/users/delete.workflow")).toBe(
      "/admin/users",
    )
  })

  it("returns / for an empty path after stripping", () => {
    expect(deriveWorkflowPath("workflows/.workflow")).toBe("/")
  })

  it("keeps a non-verb final segment intact", () => {
    expect(deriveWorkflowPath("workflows/users/profile.workflow")).toBe(
      "/users/profile",
    )
  })
})

describe("expandTemplate", () => {
  const ctx = { workflowPath: "workflows/users/create.workflow" }

  it("returns non-string values unchanged", () => {
    expect(expandTemplate(42, ctx)).toBe(42)
    expect(expandTemplate(null, ctx)).toBeNull()
    expect(expandTemplate(true, ctx)).toBe(true)
    expect(expandTemplate(undefined, ctx)).toBeUndefined()
  })

  it("returns strings with no tokens unchanged", () => {
    expect(expandTemplate("hello", ctx)).toBe("hello")
  })

  it("replaces {workflow_path} with the derived route path", () => {
    expect(
      expandTemplate("{workflow_path}", { workflowPath: "workflows/users/create.workflow" }),
    ).toBe("/users")
  })

  it("replaces {workflow_path} mid-string", () => {
    expect(
      expandTemplate("{workflow_path}/edit", { workflowPath: "workflows/users/create.workflow" }),
    ).toBe("/users/edit")
  })

  it("replaces multiple occurrences of {workflow_path}", () => {
    expect(
      expandTemplate("{workflow_path} and {workflow_path}", ctx),
    ).toBe("/users and /users")
  })

  it("uses the derived path, not the raw file path", () => {
    expect(
      expandTemplate("{workflow_path}", { workflowPath: "workflows/admin/users/delete.workflow" }),
    ).toBe("/admin/users")
  })
})
