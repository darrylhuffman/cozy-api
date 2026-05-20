import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineNode } from "./define-node.js"

describe("defineNode", () => {
  it("preserves the definition object", () => {
    const node = defineNode({
      name: "Greet",
      inputs: z.object({ who: z.string() }),
      outputs: z.object({ greeting: z.string() }),
      async run({ who }) {
        return { greeting: `Hello, ${who}` }
      },
    })
    expect(node.name).toBe("Greet")
    expect(node.kind).toBe("node")
    expect(node.inputs).toBeDefined()
    expect(node.outputs).toBeDefined()
  })

  it("the run function works when invoked directly", async () => {
    const node = defineNode({
      inputs: z.object({ a: z.number(), b: z.number() }),
      outputs: z.object({ sum: z.number() }),
      async run({ a, b }) {
        return { sum: a + b }
      },
    })
    // Direct invocation: a node IS a callable module.
    const result = await node.run({ a: 2, b: 3 }, {} as never, undefined)
    expect(result).toEqual({ sum: 5 })
  })

  it("infers run's input type from the inputs schema", () => {
    // This compiles only if defineNode's generics flow correctly.
    defineNode({
      inputs: z.object({ name: z.string(), age: z.number() }),
      outputs: z.object({ ok: z.boolean() }),
      async run({ name, age }) {
        const _typed: string = name
        const _typedAge: number = age
        return { ok: name.length > 0 && age > 0 }
      },
    })
  })
})
