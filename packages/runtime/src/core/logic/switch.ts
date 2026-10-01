import { z } from "zod"
import { defineNode } from "../../define-node.js"
import { switchBranches } from "./compare.js"

/**
 * Routes the workflow by value. Compares `value` (or the attribute `field`
 * names inside it) with each case in order; the first match's `caseN` output
 * is true, or `default` when none match. Wire a branch into a node's
 * condition handle to run that node only on that branch.
 */
export default defineNode({
  name: "Switch",
  inputs: z.object({
    value: z.unknown(),
    field: z.string().optional().describe("Attribute to compare when value is an object"),
    cases: z.array(z.unknown()).default([]),
  }),
  outputs: z.object({ value: z.unknown(), default: z.boolean() }).catchall(z.unknown()),
  async run({ value, field, cases }) {
    return { value, ...switchBranches(value, field, cases) } as { value: unknown; default: boolean }
  },
})
