import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"

export default defineNode({
  inputs: z.object({}),
  outputs: z.object({}),
  async run(input) {
    return {}
  },
})
