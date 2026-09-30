import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"
import type { PetStoreDb } from "../../src/db.js"
import { idSchema, petSchema, petStatusSchema } from "../../src/schemas.js"

export default defineNode({
  name: "Update Pet Status",
  color: "orange",
  inputs: z.object({
    id: idSchema,
    status: petStatusSchema,
  }),
  outputs: z.object({
    status: z.number(),
    body: z.union([petSchema, z.object({ error: z.string() })]),
  }),
  /**
   * Moves a pet to a new status: available, pending or sold.
   *
   * @param input - The pet id and the new status.
   * @returns 200 with the updated pet, or 404 when there is no such pet.
   */
  async run({ id, status }, services) {
    const { db } = services as { db: PetStoreDb }
    const pet = await db.updatePetStatus(id, status)
    if (!pet) return { status: 404, body: { error: `pet ${id} not found` } }
    return { status: 200, body: pet }
  },
})
