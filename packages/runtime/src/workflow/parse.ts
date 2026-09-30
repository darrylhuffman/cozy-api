import type { z } from "zod"
import { NodeInstanceSchema, WorkflowFileSchema } from "./schema.js"
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
      (i) => i.path[0] === "lorien" && i.code === "invalid_value",
    )
    if (versionIssue) {
      throw new WorkflowParseError(
        `Unsupported lorien version. This runtime expects \`lorien: 1\`.`,
        result.error.issues,
      )
    }
    throw new WorkflowParseError(
      `Invalid workflow file:\n${result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}${hint(i)}`).join("\n")}`,
      result.error.issues,
    )
  }
  return result.data
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

/** Keys people reach for that mean one of a node's real keys. */
const LIKELY: Record<string, string> = {
  input: "in",
  inputs: "in",
  config: "values",
  with: "values",
  params: "values",
  if: "when",
  condition: "when",
  dependsOn: "after",
  use: "uses",
}

/** " (did you mean `in`?)" for an unknown key on a node, when there's a likely match. */
function hint(issue: z.core.$ZodIssue): string {
  if (issue.code !== "unrecognized_keys" || issue.path[0] !== "nodes" || issue.path.length !== 2)
    return ""
  const known = Object.keys(NodeInstanceSchema.shape)
  const guesses = issue.keys
    .map((k) => LIKELY[k] ?? known.find((name) => editDistance(k, name) <= 2))
    .filter((g): g is string => g !== undefined)
  return guesses.length > 0 ? ` (did you mean ${guesses.map((g) => `\`${g}\``).join(", ")}?)` : ""
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = row[j]!
      row[j] = next
    }
  }
  return row[b.length]!
}
