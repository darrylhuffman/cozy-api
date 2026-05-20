import type { ZodObjectAny } from "@darrylondil/lorien-runtime"
import { importNodes } from "@darrylondil/lorien-runtime"

export interface NodeSchemas {
  /** The "uses" key: e.g. "./nodes/say-hello". */
  uses: string
  /** "node" or "trigger". */
  kind: "node" | "trigger"
  /** Optional display name from defineNode/defineTrigger. */
  name?: string
  /** Input schema (triggers don't have inputs — undefined). */
  inputs?: ZodObjectAny
  /** Output schema (always present). */
  outputs: ZodObjectAny
  /** Optional config schema. */
  config?: ZodObjectAny
}

export interface ExtractResult {
  schemas: NodeSchemas[]
  errors: Array<{ uses: string; message: string }>
}

/**
 * Walks <root>/nodes/ via importNodes and returns a structured per-node
 * schema list. Errors from import are collected (not thrown).
 */
export async function extractSchemas(root: string): Promise<ExtractResult> {
  const imported = await importNodes(root)
  const schemas: NodeSchemas[] = []
  const errors: ExtractResult["errors"] = []

  for (const [uses, mod] of Object.entries(imported.nodes)) {
    try {
      if (mod.kind === "node") {
        const entry: NodeSchemas = {
          uses,
          kind: "node",
          outputs: mod.outputs,
        }
        if (mod.name !== undefined) entry.name = mod.name
        if ((mod as { inputs?: ZodObjectAny }).inputs !== undefined) {
          entry.inputs = (mod as { inputs: ZodObjectAny }).inputs
        }
        if (mod.config !== undefined) entry.config = mod.config
        schemas.push(entry)
      } else if (mod.kind === "trigger") {
        const entry: NodeSchemas = {
          uses,
          kind: "trigger",
          outputs: mod.outputs,
        }
        if (mod.name !== undefined) entry.name = mod.name
        if (mod.config !== undefined) entry.config = mod.config
        schemas.push(entry)
      }
    } catch (e) {
      errors.push({ uses, message: (e as Error).message })
    }
  }

  // Propagate any importNodes errors
  for (const e of imported.errors) {
    errors.push({ uses: e.path, message: e.message })
  }

  return { schemas, errors }
}
