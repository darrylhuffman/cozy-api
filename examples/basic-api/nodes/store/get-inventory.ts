import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"

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
  async run(_input, { db }) {
    return { inventory: await db.inventory() }
  },
})
