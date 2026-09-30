import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"

const petShape = z.object({
  id: z.number(),
  name: z.string(),
  species: z.string(),
  status: z.enum(["available", "pending", "sold"]),
})
const petStatus = z.enum(["available", "pending", "sold"])

/** The part of the `db` service (src/db.ts) this node uses. */
interface Db {
  addPet(p: { name: string; species: string; status: string }): Promise<z.infer<typeof petShape>>
}

export default defineNode({
  name: "Add Pet",
  color: "yellow",
  inputs: z.object({
    name: z.string().trim().min(1, "name is required"),
    species: z.string().trim().min(1, "species is required"),
    status: petStatus.default("available"),
  }),
  outputs: z.object({
    pet: petShape,
  }),
  /**
   * Adds a pet to the store's SQLite database.
   *
   * @param input - The pet's name, species and optional starting status.
   * @returns The stored pet, with the id the database assigned.
   */
  async run({ name, species, status }, services) {
    const { db, logger } = services as {
      db: Db
      logger: { info(msg: string, fields?: Record<string, unknown>): void }
    }
    const pet = await db.addPet({ name, species, status })
    logger.info("pet added", { id: pet.id, name: pet.name })
    return { pet }
  },
})
