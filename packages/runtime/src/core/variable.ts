import { z } from "zod"
import { defineNode } from "../define-node.js"

/**
 * A named constant on the canvas. Its value lives in the workflow file under
 * `values: { value }`, and other nodes read it as `<id>.value`. The IDE makes
 * one when an input handle is dragged out onto empty canvas, typed from that
 * input's schema.
 */
export default defineNode({
  name: "Variable",
  inputs: z.object({ value: z.unknown() }),
  outputs: z.object({ value: z.unknown() }),
  async run({ value }) {
    return { value }
  },
})
