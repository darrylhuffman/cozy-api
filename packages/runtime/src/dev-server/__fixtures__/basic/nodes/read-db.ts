import { z } from "zod"
import { defineNode } from "../../../../index.js"

interface DbLike {
  ping(): string
}

export default defineNode({
  name: "Read DB Ping",
  inputs: z.object({}),
  outputs: z.object({ value: z.string() }),
  async run(_, services) {
    const db = (services as { db: DbLike }).db
    return { value: db.ping() }
  },
})
