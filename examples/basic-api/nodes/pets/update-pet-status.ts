import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"

const petShape = z.object({
  id: z.number(),
  name: z.string(),
  species: z.string(),
  status: z.enum(["available", "pending", "sold"]),
})
const petStatus = z.enum(["available", "pending", "sold"])
/** Path params and captured request variables arrive as strings. */
const idParam = z.coerce.number().int().positive()

/** The part of the `db` service (src/db.ts) this node uses. */
interface Db {
  updatePetStatus(id: number, status: string): Promise<z.infer<typeof petShape> | null>
}

export default defineNode({
  name: "Update Pet Status",
  color: "orange",
  inputs: z.object({
    id: idParam,
    status: petStatus,
  }),
  outputs: z.object({
    status: z.number(),
    body: z.union([petShape, z.object({ error: z.string() })]),
  }),
  /**
   * Moves a pet to a new status: available, pending or sold.
   *
   * @param input - The pet id and the new status.
   * @returns 200 with the updated pet, or 404 when there is no such pet.
   */
  async run({ id, status }, services) {
    const { db } = services as { db: Db }
    const pet = await db.updatePetStatus(id, status)
    if (!pet) return { status: 404, body: { error: `pet ${id} not found` } }
    return { status: 200, body: pet }
  },
})
