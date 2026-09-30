import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"
import type { PetStoreDb } from "../../src/db.js"
import { idSchema, petSchema } from "../../src/schemas.js"

export default defineNode({
  name: "Find Pet",
  color: "sky",
  inputs: z.object({
    id: idSchema,
  }),
  outputs: z.object({
    status: z.number(),
    body: z.union([petSchema, z.object({ error: z.string() })]),
  }),
  /**
   * Looks a pet up by id.
   *
   * @param input - The pet id, usually the `:id` path param.
   * @returns 200 with the pet, or 404 with an error when there is no such pet.
   */
  async run({ id }, services) {
    const { db } = services as { db: PetStoreDb }
    const pet = await db.getPet(id)
    if (!pet) return { status: 404, body: { error: `pet ${id} not found` } }
    return { status: 200, body: pet }
  },
})
