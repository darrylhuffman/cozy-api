import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"

/** The part of the `db` service (src/db.ts) this node uses. */
interface Db {
  inventory(): Promise<{ available: number; pending: number; sold: number }>
}

export default defineNode({
  name: "Get Inventory",
  color: "violet",
  inputs: z.object({}),
  outputs: z.object({
    inventory: z.object({ available: z.number(), pending: z.number(), sold: z.number() }),
  }),
  /**
   * Counts pets by status.
   *
   * @returns How many pets are available, pending and sold.
   */
  async run(_input, services) {
    const { db } = services as { db: Db }
    return { inventory: await db.inventory() }
  },
})
