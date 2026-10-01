import { z } from "zod"
import { defineNode } from "../../../../../index.js"

export default defineNode({
  name: "Check Capacity",
  inputs: z.object({
    event: z.object({ seatsLeft: z.number(), priceCents: z.number() }),
    quantity: z.number().int().min(1),
  }),
  outputs: z.object({
    available: z.boolean(),
    totalCents: z.number(),
    error: z.object({ error: z.string() }).nullable(),
  }),
  async run({ event, quantity }) {
    const available = event.seatsLeft >= quantity
    return {
      available,
      totalCents: event.priceCents * quantity,
      error: available ? null : { error: "sold out" },
    }
  },
})
