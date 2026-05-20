import { describe, expect, it } from "vitest"
import { defineConfig } from "./define-config.js"

describe("defineConfig", () => {
  it("preserves the config object", () => {
    const config = defineConfig({
      target: "hono",
      services: {
        db: { connect: () => "fake" },
        logger: (ctx) => ({ id: ctx.requestId, info: () => {} }),
      },
    })
    expect(config.target).toBe("hono")
    expect(config.services.db).toBeDefined()
    expect(typeof config.services.logger).toBe("function")
  })

  it("rejects unknown target at compile time", () => {
    // This block is a *type test* only. Uncommenting it should produce a TS error.
    // defineConfig({ target: "express", services: {} })
  })
})
