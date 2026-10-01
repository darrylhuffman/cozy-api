import { z } from "zod"
import { defineNode } from "../../define-node.js"
import { IF_OPERATORS, pickField, testCondition } from "./compare.js"

/**
 * Branches two ways. Tests `value` (or its attribute `field`) with
 * `operator` against `compare`; `true` is set when it holds, `false` when it
 * doesn't.
 */
export default defineNode({
  name: "If / Else",
  inputs: z.object({
    value: z.unknown(),
    field: z.string().optional().describe("Attribute to test when value is an object"),
    operator: z.enum(IF_OPERATORS).default("is truthy"),
    compare: z.unknown().optional(),
  }),
  outputs: z.object({ true: z.boolean(), false: z.boolean(), value: z.unknown() }),
  async run({ value, field, operator, compare }) {
    const holds = testCondition(pickField(value, field), operator, compare)
    return { true: holds, false: !holds, value }
  },
})
