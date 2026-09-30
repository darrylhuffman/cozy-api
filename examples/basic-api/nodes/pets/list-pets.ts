import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"
import type { PetStoreDb } from "../../src/db.js"
import { petSchema, petStatusSchema } from "../../src/schemas.js"

export default defineNode({
  name: "List Pets",
  color: "sky",
  inputs: z.object({
    status: petStatusSchema.optional(),
    species: z.string().optional(),
  }),
  outputs: z.object({
    pets: z.array(petSchema),
  }),
  /**
   * Lists pets, optionally filtered by status and species.
   *
   * @param input - Optional `status` and `species` filters, usually from the query string.
   * @returns Every matching pet, oldest first.
   */
  async run({ status, species }, services) {
    const { db } = services as { db: PetStoreDb }
    const pets = await db.listPets({
      ...(status ? { status } : {}),
      ...(species ? { species } : {}),
    })
    return { pets }
  },
})
