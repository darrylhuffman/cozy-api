import { z } from "zod"
import { defineNode } from "../define-node.js"

/**
 * Built-in response terminator. When this node fires, the workflow run completes
 * and the host (Hono in v1) sends the response.
 */
export default defineNode({
  name: "Response",
  inputs: z.object({
    body: z.unknown(),
    status: z.number().int().min(100).max(599).optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  outputs: z.object({
    sent: z.boolean(),
  }),
  async run({ body, status, headers }) {
    // The runner intercepts @core/response before reaching here normally —
    // it reads the input to construct the HTTP response. We still execute the body so
    // that direct programmatic calls (in tests) get a meaningful return value.
    void body
    void status
    void headers
    return { sent: true }
  },
})
