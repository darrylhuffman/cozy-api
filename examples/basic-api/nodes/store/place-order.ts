import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"
import { idSchema, orderSchema } from "../../lib/schemas.js"

export default defineNode({
  name: "Place Order",
  color: "emerald",
  inputs: z.object({
    petId: idSchema,
    quantity: z.coerce.number().int().min(1).default(1),
  }),
  outputs: z.object({
    status: z.number(),
    body: z.union([orderSchema, z.object({ error: z.string() })]),
  }),
  /**
   * Orders a pet. Only available pets can be ordered; ordering marks the pet pending.
   *
   * @param input - The pet to order and how many.
   * @returns 201 with the order, 404 for an unknown pet, or 409 when it is not available.
   */
  async run({ petId, quantity }, { db }) {
    const pet = await db.getPet(petId)
    if (!pet) return { status: 404, body: { error: `pet ${petId} not found` } }
    if (pet.status !== "available") {
      return { status: 409, body: { error: `${pet.name} is ${pet.status}` } }
    }
    const order = await db.placeOrder(petId, quantity)
    return { status: 201, body: order }
  },
})
