import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"
import type { PetStoreDb } from "../../src/db.js"
import { petSchema, petStatusSchema } from "../../src/schemas.js"

export default defineNode({
  name: "Add Pet",
  color: "yellow",
  inputs: z.object({
    name: z.string().trim().min(1, "name is required"),
    species: z.string().trim().min(1, "species is required"),
    status: petStatusSchema.default("available"),
  }),
  outputs: z.object({
    pet: petSchema,
  }),
  /**
   * Adds a pet to the store's SQLite database.
   *
   * @param input - The pet's name, species and optional starting status.
   * @returns The stored pet, with the id the database assigned.
   */
  async run({ name, species, status }, services) {
    const { db, logger } = services as {
      db: PetStoreDb
      logger: { info(msg: string, fields?: Record<string, unknown>): void }
    }
    const pet = await db.addPet({ name, species, status })
    logger.info("pet added", { id: pet.id, name: pet.name })
    return { pet }
  },
})
