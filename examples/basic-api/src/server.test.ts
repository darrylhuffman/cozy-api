import { describe, expect, it } from "vitest"
import { buildApp } from "./server.js"

describe("dev server end-to-end", () => {
  it("serves POST /users", async () => {
    const app = await buildApp()
    const res = await app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "hunter2" }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; email: string }
    expect(body.email).toBe("ada@example.com")
    expect(typeof body.id).toBe("string")
  })

  it("returns a server error on invalid input", async () => {
    const app = await buildApp()
    const res = await app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bad", password: "x" }),
    })
    expect(res.status).toBeGreaterThanOrEqual(500)
  })
})
