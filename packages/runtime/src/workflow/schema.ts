import { z } from "zod"

export const NodeInstanceSchema = z.object({
  uses: z.string().min(1),
  /**
   * Inputs may be supplied in either of two shapes — both are REFERENCES ONLY:
   *  - per-field object:  { fieldName: "ref-string", ... }
   *    Each value is a reference string like "nodeId.path.to.field". Literals
   *    must NOT appear here — they belong under `values:` instead.
   *  - single reference string: "ref" — the whole resolved value is passed as
   *    the node's input. The value must parse as a reference.
   */
  in: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  /**
   * Per-field literal values. Any JSON-serializable value is allowed. Strings
   * here are NEVER interpreted as references — they are user-typed literals
   * (e.g. `{ method: "GET", status: 201 }`). At evaluation time, `values:`
   * acts as the floor; `in:` references override per field.
   */
  values: z.record(z.string(), z.unknown()).optional(),
  after: z.array(z.string()).optional(),
  label: z.string().optional(),
})

export const NodeViewSchema = z.object({
  x: z.number(),
  y: z.number(),
})

export const WorkflowFileSchema = z.object({
  lorien: z.literal(1),
  nodes: z.record(z.string(), NodeInstanceSchema),
  view: z.record(z.string(), NodeViewSchema).optional(),
})

export type NodeInstance = z.infer<typeof NodeInstanceSchema>
export type NodeView = z.infer<typeof NodeViewSchema>
export type WorkflowFile = z.infer<typeof WorkflowFileSchema>
