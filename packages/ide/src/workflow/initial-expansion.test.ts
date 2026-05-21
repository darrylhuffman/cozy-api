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
    expect(computeInitialInputExpansion(emptyRoot, undefined)).toEqual(new Set())
  })

  it("returns an empty set when `in:` is the whole-object string form", () => {
    const root = rootBranch([leaf("email"), leaf("password")])
    expect(computeInitialInputExpansion(root, "request.body")).toEqual(new Set())
  })

  it("returns expanded root when no fields are bound", () => {
    const root = rootBranch([leaf("email"), leaf("password")])
    expect(computeInitialInputExpansion(root, undefined)).toEqual(new Set([""]))
    expect(computeInitialInputExpansion(root, {})).toEqual(new Set([""]))
  })

  it("returns expanded root when only some fields are bound", () => {
    const root = rootBranch([leaf("email"), leaf("password")])
    expect(
      computeInitialInputExpansion(root, { email: "request.body.email" }),
    ).toEqual(new Set([""]))
  })

  it("returns collapsed root when all required fields are bound", () => {
    const root = rootBranch([leaf("email"), leaf("password")])
    expect(
      computeInitialInputExpansion(root, {
        email: "request.body.email",
        password: "request.body.password",
      }),
    ).toEqual(new Set())
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
