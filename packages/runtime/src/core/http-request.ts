import { z } from "zod"
import { defineTrigger } from "../define-trigger.js"

/**
 * Built-in HTTP request trigger. v1 supports JSON bodies; non-JSON is exposed as raw text.
 * Path/method config drives route registration in the dev server / codegen.
 */
export default defineTrigger({
  name: "HTTP Request",
  config: z.object({
    path: z.string().describe("Route path, e.g. /users/:id").default("{workflow_path}"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).default("GET"),
  }),
  outputs: z.object({
    body: z.unknown(),
    params: z.record(z.string(), z.string()),
    query: z.record(z.string(), z.string()),
    headers: z.record(z.string(), z.string()),
    context: z.object({
      requestId: z.string(),
      timestamp: z.number(),
    }),
  }),
})
