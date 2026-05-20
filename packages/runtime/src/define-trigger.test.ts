import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineTrigger } from "./define-trigger.js"

describe("defineTrigger", () => {
  it("creates a trigger with kind='trigger'", () => {
    const trigger = defineTrigger({
      name: "HTTP Request",
      config: z.object({ path: z.string(), method: z.string() }),
      outputs: z.object({ body: z.unknown() }),
    })
    expect(trigger.kind).toBe("trigger")
    expect(trigger.name).toBe("HTTP Request")
  })

  it("triggers don't have run() or inputs", () => {
    const trigger = defineTrigger({
      outputs: z.object({ x: z.number() }),
    })
    expect((trigger as Record<string, unknown>).run).toBeUndefined()
    expect((trigger as Record<string, unknown>).inputs).toBeUndefined()
  })
})
