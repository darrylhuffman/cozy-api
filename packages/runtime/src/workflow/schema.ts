import { z } from "zod"

export const NodeInstanceSchema = z.object({
  uses: z.string().min(1),
  in: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
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
