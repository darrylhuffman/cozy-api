import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"

const petShape = z.object({
  id: z.number(),
  name: z.string(),
  species: z.string(),
  status: z.enum(["available", "pending", "sold"]),
})
/** Path params and captured request variables arrive as strings. */
const idParam = z.coerce.number().int().positive()

/** The part of the `db` service (src/db.ts) this node uses. */
interface Db {
  getPet(id: number): Promise<z.infer<typeof petShape> | null>
}

export default defineNode({
  name: "Find Pet",
  color: "sky",
  inputs: z.object({
    id: idParam,
  }),
  outputs: z.object({
    status: z.number(),
    body: z.union([petShape, z.object({ error: z.string() })]),
  }),
  /**
   * Looks a pet up by id.
   *
   * @param input - The pet id, usually the `:id` path param.
   * @returns 200 with the pet, or 404 with an error when there is no such pet.
   */
  async run({ id }, services) {
    const { db } = services as { db: Db }
    const pet = await db.getPet(id)
    if (!pet) return { status: 404, body: { error: `pet ${id} not found` } }
    return { status: 200, body: pet }
  },
})
