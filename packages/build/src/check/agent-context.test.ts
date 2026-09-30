import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { agentProjectContext } from "./agent-context.js"

const EXAMPLE = resolve(import.meta.dirname, "..", "..", "..", "..", "examples", "basic-api")

describe("agentProjectContext", () => {
  it("lists where things go and the pet store's providers and middleware", async () => {
    const text = await agentProjectContext(EXAMPLE)
    expect(text).toMatch(/^<lorien-project>/)
    expect(text).toContain("Business logic: a node in nodes/")
    expect(text).toContain("- db (singleton, providers/db.ts): The pet store's SQLite database")
    expect(text).toContain("- logger (scoped, providers/logger.ts)")
    expect(text).toContain("- workflows/_middleware.ts (Request log)")
    expect(text).toContain("lorien check")
  })
})
