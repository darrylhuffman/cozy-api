import { describe, expect, it } from "vitest"
import type { PortNode } from "./schema-to-tree.js"
import {
  computeVisibleInputPaths,
  computeVisibleOutputPaths,
  effectiveHandle,
} from "./effective-handle.js"

const leaf = (id: string, label = id): PortNode => ({
  id,
  label,
  children: [],
  isLeaf: true,
})

const branch = (id: string, children: PortNode[], label?: string): PortNode => ({
  id,
  label: label ?? id,
  children,
  isLeaf: false,
})

const rootBranch = (children: PortNode[]): PortNode => ({
  id: "",
  label: "input",
  children,
  isLeaf: false,
})

const emptyRoot: PortNode = { id: "", label: "input", children: [], isLeaf: true }

describe("effectiveHandle (visible-paths model)", () => {
  it("returns the leaf itself when its full path is visible", () => {
    expect(effectiveHandle("user.email", new Set(["", "user", "user.email"]))).toBe(
      "user.email",
    )
  })

  it("walks up to the deepest visible ancestor", () => {
    expect(effectiveHandle("user.email", new Set(["", "user"]))).toBe("user")
  })

  it("falls back to the root when only the root is visible", () => {
    expect(effectiveHandle("user.email", new Set([""]))).toBe("")
  })

  it("anchors to a leaf source whose nested path doesn't exist as a handle", () => {
    // Reference is `body.email`, but the source side renders only `body` as a
    // leaf (opaque output). Walking up from `body.email` must return `body`.
    expect(effectiveHandle("body.email", new Set(["body"]))).toBe("body")
  })

  it("returns a top-level handle when it exists in the visible set", () => {
    expect(effectiveHandle("body", new Set(["body"]))).toBe("body")
  })

  it("returns '' for the root path regardless of the set", () => {
    expect(effectiveHandle("", new Set())).toBe("")
    expect(effectiveHandle("", new Set(["user"]))).toBe("")
  })

  it("walks deep paths until something matches", () => {
    expect(effectiveHandle("body.user.email", new Set([""]))).toBe("")
    expect(effectiveHandle("body.user.email", new Set(["", "body"]))).toBe("body")
    expect(effectiveHandle("body.user.email", new Set(["", "body", "body.user"]))).toBe(
      "body.user",
    )
    expect(
      effectiveHandle(
        "body.user.email",
        new Set(["", "body", "body.user", "body.user.email"]),
      ),
    ).toBe("body.user.email")
  })

  it("returns '' when nothing along the chain is visible", () => {
    expect(effectiveHandle("missing.path", new Set())).toBe("")
  })
})

describe("computeVisibleInputPaths", () => {
  it("always includes the root, regardless of expansion", () => {
    expect(computeVisibleInputPaths(emptyRoot, new Set())).toEqual(new Set([""]))
  })

  it("hides children when the root is not expanded", () => {
    const root = rootBranch([leaf("email"), leaf("password")])
    expect(computeVisibleInputPaths(root, new Set())).toEqual(new Set([""]))
  })

  it("reveals direct children when the root is expanded", () => {
    const root = rootBranch([leaf("email"), leaf("password")])
    expect(computeVisibleInputPaths(root, new Set([""]))).toEqual(
      new Set(["", "email", "password"]),
    )
  })

  it("descends into nested branches that are themselves expanded", () => {
    const root = rootBranch([branch("user", [leaf("user.email")])])
    expect(computeVisibleInputPaths(root, new Set(["", "user"]))).toEqual(
      new Set(["", "user", "user.email"]),
    )
  })

  it("does not descend into a branch whose path is not expanded", () => {
    const root = rootBranch([branch("user", [leaf("user.email")])])
    expect(computeVisibleInputPaths(root, new Set([""]))).toEqual(
      new Set(["", "user"]),
    )
  })
})

describe("computeVisibleOutputPaths", () => {
  it("always includes every top-level port id", () => {
    const outputs = [leaf("body"), leaf("headers")]
    expect(computeVisibleOutputPaths(outputs, new Set())).toEqual(
      new Set(["body", "headers"]),
    )
  })

  it("reveals children of an expanded branch", () => {
    const outputs = [branch("body", [leaf("body.email")])]
    expect(computeVisibleOutputPaths(outputs, new Set(["body"]))).toEqual(
      new Set(["body", "body.email"]),
    )
  })

  it("hides children of a collapsed branch", () => {
    const outputs = [branch("body", [leaf("body.email")])]
    expect(computeVisibleOutputPaths(outputs, new Set())).toEqual(new Set(["body"]))
  })

  it("recurses through deeply expanded branches", () => {
    const outputs = [
      branch("body", [branch("body.user", [leaf("body.user.name")])]),
    ]
    expect(
      computeVisibleOutputPaths(outputs, new Set(["body", "body.user"])),
    ).toEqual(new Set(["body", "body.user", "body.user.name"]))
  })
})
