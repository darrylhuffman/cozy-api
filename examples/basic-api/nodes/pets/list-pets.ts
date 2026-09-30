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
  listPets(filter: { status?: string; species?: string }): Promise<z.infer<typeof petShape>[]>
}

export default defineNode({
  name: "List Pets",
  color: "sky",
  inputs: z.object({
    status: petStatus.optional(),
    species: z.string().optional(),
  }),
  outputs: z.object({
    pets: z.array(petShape),
  }),
  /**
   * Lists pets, optionally filtered by status and species.
   *
   * @param input - Optional `status` and `species` filters, usually from the query string.
   * @returns Every matching pet, oldest first.
   */
  async run({ status, species }, services) {
    const { db } = services as { db: Db }
    const pets = await db.listPets({
      ...(status ? { status } : {}),
      ...(species ? { species } : {}),
    })
    return { pets }
  },
})
