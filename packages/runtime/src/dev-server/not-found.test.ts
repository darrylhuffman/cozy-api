import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { allowedMethods, answerUnmatchedWithJson } from "./not-found.js"

describe("unmatched requests", () => {
  const app = new Hono()
  app.use("*", async (_c, next) => next())
  app.get("/books/:id", (c) => c.json({ ok: true }))
  app.post("/books", (c) => c.json({ ok: true }, 201))
  app.get("/books", (c) => c.json([]))
  answerUnmatchedWithJson(app)

  it("answers 405 with Allow when the path exists under another method", async () => {
    const res = await app.request("/books/7", { method: "DELETE" })
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("GET")
    expect(await res.json()).toEqual({ error: "Method Not Allowed" })
    expect((await app.request("/books", { method: "PUT" })).headers.get("allow")).toBe("POST, GET")
  })

  it("answers JSON 404 when no route has the path", async () => {
    const res = await app.request("/nope")
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Not Found" })
  })

  it("matches params one segment at a time", () => {
    const routes = [{ method: "GET", path: "/books/:id" }]
    expect(allowedMethods(routes, "/books/7")).toEqual(["GET"])
    expect(allowedMethods(routes, "/books/7/loans")).toEqual([])
    expect(allowedMethods(routes, "/books")).toEqual([])
  })
})
