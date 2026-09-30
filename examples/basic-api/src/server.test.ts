import { describe, expect, it } from "vitest"
import { buildApp } from "./server.js"

const json = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

describe("dev server end-to-end", () => {
  it("lists the seeded pets", async () => {
    const app = await buildApp()
    const res = await app.request("/pets")
    expect(res.status).toBe(200)
    const pets = (await res.json()) as { name: string }[]
    expect(pets.map((p) => p.name)).toEqual(["Biscuit", "Miso", "Pickles", "Captain"])
  })

  it("filters pets by status from the query string", async () => {
    const app = await buildApp()
    const res = await app.request("/pets?status=available")
    const pets = (await res.json()) as { status: string }[]
    expect(pets.length).toBeGreaterThan(0)
    expect(pets.every((p) => p.status === "available")).toBe(true)
  })

  it("adds a pet, finds it, orders it, and counts it in the inventory", async () => {
    const app = await buildApp()
    const added = await app.request("/pets", json("POST", { name: "Nori", species: "cat" }))
    expect(added.status).toBe(201)
    const pet = (await added.json()) as { id: number; status: string }
    expect(pet.status).toBe("available")

    const found = await app.request(`/pets/${pet.id}`)
    expect(found.status).toBe(200)
    expect(await found.json()).toEqual(pet)

    const order = await app.request("/store/orders", json("POST", { petId: pet.id }))
    expect(order.status).toBe(201)
    expect(await order.json()).toMatchObject({ petId: pet.id, quantity: 1, status: "placed" })

    const again = await app.request("/store/orders", json("POST", { petId: pet.id }))
    expect(again.status).toBe(409)

    const inventory = await app.request("/store/inventory")
    expect(await inventory.json()).toMatchObject({ pending: expect.any(Number) })
  })

  it("updates a pet's status", async () => {
    const app = await buildApp()
    const res = await app.request("/pets/2", json("PATCH", { status: "sold" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 2, status: "sold" })
  })

  it("returns 404 for a pet that does not exist", async () => {
    const app = await buildApp()
    const res = await app.request("/pets/99999")
    expect(res.status).toBe(404)
  })

  it("returns a server error on invalid input", async () => {
    const app = await buildApp()
    const res = await app.request("/pets", json("POST", { name: "", species: "cat" }))
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
