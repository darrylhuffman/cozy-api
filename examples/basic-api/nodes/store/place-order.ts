import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"

/** Path params and captured request variables arrive as strings. */
const idParam = z.coerce.number().int().positive()
const orderShape = z.object({
  id: z.number(),
  petId: z.number(),
  quantity: z.number(),
  status: z.literal("placed"),
  placedAt: z.string(),
})

/** The part of the `db` service (src/db.ts) this node uses. */
interface Db {
  getPet(id: number): Promise<{ name: string; status: string } | null>
  placeOrder(petId: number, quantity: number): Promise<z.infer<typeof orderShape>>
}

export default defineNode({
  name: "Place Order",
  color: "emerald",
  inputs: z.object({
    petId: idParam,
    quantity: z.coerce.number().int().min(1).default(1),
  }),
  outputs: z.object({
    status: z.number(),
    body: z.union([orderShape, z.object({ error: z.string() })]),
  }),
  /**
   * Orders a pet. Only available pets can be ordered; ordering marks the pet pending.
   *
   * @param input - The pet to order and how many.
   * @returns 201 with the order, 404 for an unknown pet, or 409 when it is not available.
   */
  async run({ petId, quantity }, services) {
    const { db } = services as { db: Db }
    const pet = await db.getPet(petId)
    if (!pet) return { status: 404, body: { error: `pet ${petId} not found` } }
    if (pet.status !== "available") {
      return { status: 409, body: { error: `${pet.name} is ${pet.status}` } }
    }
    const placed = await db.placeOrder(petId, quantity)
    return { status: 201, body: placed }
  },
})
