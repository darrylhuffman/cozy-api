import { z } from "zod"
import { defineNode } from "../../define-node.js"

/** Flips a value's truthiness. `true`/`false` branch on the flipped value. */
export default defineNode({
  name: "Not",
  inputs: z.object({ value: z.unknown() }),
  outputs: z.object({ result: z.boolean(), true: z.boolean(), false: z.boolean() }),
  async run({ value }) {
    const result = !value
    return { result, true: result, false: !result }
  },
})
