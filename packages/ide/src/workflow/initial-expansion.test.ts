import { describe, expect, it } from "vitest"
import type { NodeInstance } from "@/lib/api"
import type { PortNode } from "./derive-ports.js"
import {
  computeInitialExpansion,
  computeInitialInputExpansion,
  computeInitialOutputExpansion,
} from "./initial-expansion.js"

const leaf = (name: string): PortNode => ({
  id: name,
  label: name,
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

describe("computeInitialInputExpansion", () => {
  it("returns an empty set for trigger nodes (no input children)", () => {
    expect(computeInitialInputExpansion(emptyRoot, undefined, undefined)).toEqual(new Set())
  })

  it("returns an empty set when `in:` is the whole-object string form", () => {
    const root = rootBranch([leaf("email"), leaf("password")])
    expect(computeInitialInputExpansion(root, "request.body", undefined)).toEqual(new Set())
  })

  it("returns expanded root when no fields are bound", () => {
    const root = rootBranch([leaf("email"), leaf("password")])
    expect(computeInitialInputExpansion(root, undefined, undefined)).toEqual(new Set([""]))
    expect(computeInitialInputExpansion(root, {}, undefined)).toEqual(new Set([""]))
  })

  it("returns expanded root when only some fields are bound", () => {
    const root = rootBranch([leaf("email"), leaf("password")])
    expect(
      computeInitialInputExpansion(root, { email: "request.body.email" }, undefined),
    ).toEqual(new Set([""]))
  })

  it("returns collapsed root when all required fields are bound", () => {
    const root = rootBranch([leaf("email"), leaf("password")])
    expect(
      computeInitialInputExpansion(
        root,
        {
          email: "request.body.email",
          password: "request.body.password",
        },
        undefined,
      ),
    ).toEqual(new Set())
  })

  it("treats values: as satisfying fields (collapsed when in: + values: cover all)", () => {
    const root = rootBranch([leaf("method"), leaf("path")])
    expect(
      computeInitialInputExpansion(root, undefined, { method: "GET", path: "/users" }),
    ).toEqual(new Set())
  })

  it("expands when neither in: nor values: covers all fields", () => {
    const root = rootBranch([leaf("method"), leaf("path")])
    expect(
      computeInitialInputExpansion(root, undefined, { method: "GET" }),
    ).toEqual(new Set([""]))
  })
})

describe("computeInitialOutputExpansion", () => {
  it("returns an empty set when outputs contain only leaves", () => {
    expect(computeInitialOutputExpansion([leaf("user")])).toEqual(new Set())
  })

  it("includes every branch path so children are visible by default", () => {
    const tree = [branch("user", [leaf("id"), leaf("email")])]
    expect(computeInitialOutputExpansion(tree)).toEqual(new Set(["user"]))
  })

  it("walks deeply nested branches", () => {
    // Real port trees use dotted ids matching the schema path; mirror that here.
    const tree = [
      branch("body", [branch("body.user", [leaf("body.user.name")], "user")], "body"),
    ]
    expect(computeInitialOutputExpansion(tree)).toEqual(
      new Set(["body", "body.user"]),
    )
  })

  it("skips inferred branches so they start collapsed", () => {
    // body was promoted from a leaf by nested-reference inference. The user
    // should see it as a single handle until they explicitly expand it.
    const tree = [
      { ...branch("body", [leaf("body.email"), leaf("body.password")]), inferred: true },
    ]
    expect(computeInitialOutputExpansion(tree)).toEqual(new Set())
  })

  it("auto-expands schema-declared branches even when they have inferred children", () => {
    // Schema declared body.user as a branch; a reference adds an inferred
    // body.user.extra child. body.user is NOT inferred itself, so it stays
    // auto-expanded.
    const tree = [
      branch("body", [
        branch("body.user", [
          leaf("body.user.name"),
          { ...leaf("body.user.extra"), inferred: true },
        ]),
      ]),
    ]
    expect(computeInitialOutputExpansion(tree)).toEqual(
      new Set(["body", "body.user"]),
    )
  })
})

describe("computeInitialExpansion (combined)", () => {
  it("returns sensible defaults for a fully-bound save node", () => {
    const inputs = rootBranch([leaf("email"), leaf("password")])
    const outputs = [branch("user", [leaf("id"), leaf("email")])]
    const instance: NodeInstance = {
      uses: "./save",
      in: { email: "request.body.email", password: "request.body.password" },
    }
    const init = computeInitialExpansion({ inputs, outputs }, instance)
    expect(init.inputs).toEqual(new Set()) // collapsed — fully satisfied
    expect(init.outputs).toEqual(new Set(["user"])) // expanded
  })

  it("expands input root when no `in:` is set", () => {
    const inputs = rootBranch([leaf("email"), leaf("password")])
    const outputs: PortNode[] = []
    const init = computeInitialExpansion(
      { inputs, outputs },
      { uses: "./save" },
    )
    expect(init.inputs).toEqual(new Set([""]))
  })
})
