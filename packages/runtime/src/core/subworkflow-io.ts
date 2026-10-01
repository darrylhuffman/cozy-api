import { z } from "zod"
import { defineNode } from "../define-node.js"

const bag = z.looseObject({})

/**
 * A sub-workflow's entry. In the sub-workflow file it lists the inputs under
 * `values: { fields: { name: type } }`; the caller's card shows one port per
 * field. When a workflow runs, the sub-workflow is flattened into it and this
 * node passes on whatever the caller wired in.
 */
export const subworkflowInput = defineNode({
  name: "Input",
  inputs: bag,
  outputs: bag,
  async run(input) {
    return input
  },
})

/**
 * A sub-workflow's exit. Each `in` field is an output the caller can read.
 * When a workflow runs it passes its input straight on, so the caller's reads
 * of `<SubWorkflow>.<field>` become reads of this node.
 */
export const subworkflowOutput = defineNode({
  name: "Output",
  inputs: bag,
  outputs: bag,
  async run(input) {
    return input
  },
})
