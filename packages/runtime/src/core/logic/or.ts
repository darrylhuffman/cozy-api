import { z } from "zod"
import { defineNode } from "../../define-node.js"

/** True when either input is truthy. `true`/`false` branch on it. */
export default defineNode({
  name: "Or",
  inputs: z.object({ a: z.unknown(), b: z.unknown() }),
  outputs: z.object({ result: z.boolean(), true: z.boolean(), false: z.boolean() }),
  async run({ a, b }) {
    const result = Boolean(a) || Boolean(b)
    return { result, true: result, false: !result }
  },
})
