import { describe, expect, it } from "vitest"
import { effectiveHandle } from "./effective-handle.js"

describe("effectiveHandle", () => {
  it("returns the leaf when its parent path is expanded", () => {
    expect(effectiveHandle("user.email", new Set(["", "user"]))).toBe("user.email")
  })

  it("walks up to a visible ancestor when the leaf's parent is collapsed", () => {
    // "user.email" is hidden because "user" isn't expanded. "user" is rendered
    // because its parent (the root "") is expanded.
    expect(effectiveHandle("user.email", new Set([""]))).toBe("user")
  })

  it("falls back to the root when nothing on the chain is expanded", () => {
    expect(effectiveHandle("user.email", new Set())).toBe("")
  })

  it("returns 'user' when the root is expanded and the target IS 'user'", () => {
    expect(effectiveHandle("user", new Set([""]))).toBe("user")
  })

  it("falls back to root for a top-level handle when the root is not expanded", () => {
    expect(effectiveHandle("user", new Set())).toBe("")
  })

  it("the root is always rendered as itself, regardless of expand state", () => {
    expect(effectiveHandle("", new Set())).toBe("")
    expect(effectiveHandle("", new Set([""]))).toBe("")
    expect(effectiveHandle("", new Set(["user", "user.profile"]))).toBe("")
  })

  it("handles 3-deep paths — only the deepest expanded ancestor matters", () => {
    // body.user.email — expanded set has {""} (root) only. Visible up to "body".
    expect(effectiveHandle("body.user.email", new Set([""]))).toBe("body")
    // Add "body" — visible up to "body.user".
    expect(effectiveHandle("body.user.email", new Set(["", "body"]))).toBe("body.user")
    // Add "body.user" — full leaf is visible.
    expect(effectiveHandle("body.user.email", new Set(["", "body", "body.user"]))).toBe(
      "body.user.email",
    )
  })

  it("non-empty expanded set without root still hides everything (root not expanded)", () => {
    // This shouldn't typically happen (root must be expanded to see children
    // of the root in the first place), but we test the invariant: a candidate
    // is rendered iff its specific parent is in the set.
    expect(effectiveHandle("user.email", new Set(["user"]))).toBe("user.email")
    expect(effectiveHandle("user", new Set(["user"]))).toBe("")
  })
})
