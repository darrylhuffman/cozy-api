import { z } from "zod"
import { defineNode } from "../../../../../index.js"

export default defineNode({
  name: "Create Order",
  inputs: z.object({ eventId: z.string(), totalCents: z.number() }),
  outputs: z.object({ order: z.object({ eventId: z.string(), totalCents: z.number() }) }),
  async run({ eventId, totalCents }) {
    return { order: { eventId, totalCents } }
  },
})
