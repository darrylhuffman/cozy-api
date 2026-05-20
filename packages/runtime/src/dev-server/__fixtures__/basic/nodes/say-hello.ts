import { z } from "zod"
import { defineNode } from "../../../../index.js"

export default defineNode({
  name: "Say Hello",
  inputs: z.object({}),
  outputs: z.object({ greeting: z.string() }),
  async run() {
    return { greeting: "hello from fixture" }
  },
})
