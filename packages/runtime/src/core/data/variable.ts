import { z } from "zod"
import { defineNode } from "../../define-node.js"

/**
 * A named constant on the canvas. Its value lives in the workflow file under
 * `values: { value }`, and other nodes read it as `<id>.value`. The IDE makes
 * one when an input handle is dragged out onto empty canvas, typed from that
 * input's schema. `type` (string, number, boolean or json) picks the editor the
 * IDE shows when no input it feeds says what the value should be.
 */
export default defineNode({
  name: "Variable",
  inputs: z.object({
    value: z.unknown(),
    type: z.enum(["string", "number", "boolean", "json"]).optional(),
  }),
  outputs: z.object({ value: z.unknown() }),
  async run({ value }) {
    return { value }
  },
})
