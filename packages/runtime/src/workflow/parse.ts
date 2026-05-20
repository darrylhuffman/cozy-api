import type { z } from "zod"
import { WorkflowFileSchema } from "./schema.js"
import type { WorkflowFile } from "./types.js"

export class WorkflowParseError extends Error {
  constructor(
    message: string,
    public readonly issues?: z.ZodIssue[],
  ) {
    super(message)
    this.name = "WorkflowParseError"
  }
}

export function parseWorkflow(input: unknown): WorkflowFile {
  const result = WorkflowFileSchema.safeParse(input)
  if (!result.success) {
    const versionIssue = result.error.issues.find(
      (i) => i.path[0] === "cozy" && i.code === "invalid_value",
    )
    if (versionIssue) {
      throw new WorkflowParseError(
        `Unsupported cozy version. This runtime expects \`cozy: 1\`.`,
        result.error.issues,
      )
    }
    throw new WorkflowParseError(
      `Invalid workflow file:\n${result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
      result.error.issues,
    )
  }
  return result.data as WorkflowFile
}

/**
 * Parses a workflow from a JSON string. Throws WorkflowParseError on either
 * JSON syntax or schema validation failures.
 */
export function parseWorkflowFromString(source: string): WorkflowFile {
  let json: unknown
  try {
    json = JSON.parse(source)
  } catch (e) {
    throw new WorkflowParseError(`Invalid JSON: ${(e as Error).message}`)
  }
  return parseWorkflow(json)
}
