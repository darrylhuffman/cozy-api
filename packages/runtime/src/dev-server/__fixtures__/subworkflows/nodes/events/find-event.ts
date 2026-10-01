import { z } from "zod"
import { defineNode } from "../../../../../index.js"

const EVENTS: Record<string, { id: string; seatsLeft: number; priceCents: number }> = {
  e1: { id: "e1", seatsLeft: 10, priceCents: 500 },
  e2: { id: "e2", seatsLeft: 1, priceCents: 900 },
}

export default defineNode({
  name: "Find Event",
  inputs: z.object({ id: z.string() }),
  outputs: z.object({
    found: z.boolean(),
    event: z.object({ id: z.string(), seatsLeft: z.number(), priceCents: z.number() }).nullable(),
  }),
  async run({ id }) {
    const event = EVENTS[id] ?? null
    return { found: event !== null, event }
  },
})
