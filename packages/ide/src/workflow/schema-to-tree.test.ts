import { describe, expect, it } from "vitest"
import { schemaToRootedTree, schemaToTree } from "./schema-to-tree"

describe("schemaToTree", () => {
  it("returns [] for an undefined schema", () => {
    expect(schemaToTree(undefined)).toEqual([])
  })

  it("returns [] for a non-object schema", () => {
    expect(schemaToTree({ type: "string" })).toEqual([])
  })

  it("returns [] for an object with no properties", () => {
    expect(schemaToTree({ type: "object" })).toEqual([])
    expect(schemaToTree({ type: "object", properties: {} })).toEqual([])
  })

  it("builds leaf ports for primitive properties", () => {
    const tree = schemaToTree({
      type: "object",
      properties: {
        email: { type: "string" },
        age: { type: "number" },
        active: { type: "boolean" },
      },
    })
    expect(tree).toHaveLength(3)
    expect(tree.every((n) => n.isLeaf)).toBe(true)
    expect(tree.every((n) => n.children.length === 0)).toBe(true)
    expect(tree.map((n) => n.id).sort()).toEqual(["active", "age", "email"])
    expect(tree[0]!.label).toBe(tree[0]!.id)
  })

  it("descends into nested objects as branches", () => {
    const tree = schemaToTree({
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
    })
    expect(tree).toHaveLength(1)
    expect(tree[0]!.id).toBe("user")
    expect(tree[0]!.label).toBe("user")
    expect(tree[0]!.isLeaf).toBe(false)
    expect(tree[0]!.children).toHaveLength(2)
    const childIds = tree[0]!.children.map((c) => c.id).sort()
    expect(childIds).toEqual(["user.email", "user.id"])
    expect(tree[0]!.children.every((c) => c.isLeaf)).toBe(true)
  })

  it("treats arrays as leaves (v1 doesn't expand them)", () => {
    const tree = schemaToTree({
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
      },
    })
    expect(tree).toHaveLength(1)
    expect(tree[0]!.isLeaf).toBe(true)
    expect(tree[0]!.children).toEqual([])
  })

  it("treats unknown/opaque properties as leaves", () => {
    const tree = schemaToTree({
      type: "object",
      properties: {
        body: {}, // any
      },
    })
    expect(tree).toHaveLength(1)
    expect(tree[0]!.isLeaf).toBe(true)
  })

  describe("schemaToRootedTree", () => {
    it("returns a root branch (id = '', label = 'input') with schema fields as children", () => {
      const root = schemaToRootedTree({
        type: "object",
        properties: { email: { type: "string" }, password: { type: "string" } },
      })
      expect(root.id).toBe("")
      expect(root.label).toBe("input")
      expect(root.isLeaf).toBe(false)
      expect(root.children).toHaveLength(2)
      expect(root.children.map((c) => c.id).sort()).toEqual(["email", "password"])
    })

    it("returns a leaf root when the schema has no properties", () => {
      const root = schemaToRootedTree({ type: "object" })
      expect(root.id).toBe("")
      expect(root.isLeaf).toBe(true)
      expect(root.children).toEqual([])
    })

    it("returns a leaf root for an undefined schema", () => {
      const root = schemaToRootedTree(undefined)
      expect(root.id).toBe("")
      expect(root.isLeaf).toBe(true)
    })

    it("supports a custom root label", () => {
      const root = schemaToRootedTree({ type: "object" }, "body")
      expect(root.label).toBe("body")
    })
  })

  it("builds dotted ids for deep nesting", () => {
    const tree = schemaToTree({
      type: "object",
      properties: {
        a: {
          type: "object",
          properties: {
            b: {
              type: "object",
              properties: {
                c: { type: "string" },
              },
            },
          },
        },
      },
    })
    expect(tree[0]!.id).toBe("a")
    expect(tree[0]!.children[0]!.id).toBe("a.b")
    expect(tree[0]!.children[0]!.children[0]!.id).toBe("a.b.c")
  })
})
