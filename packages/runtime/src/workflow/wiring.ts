import { canonicalCoreId } from "../core/registry.js"
import type { AnyNodeOrTrigger } from "../types.js"
import { parseWhen } from "./dependencies.js"
import { parseReference } from "./reference.js"
import type { WorkflowFile } from "./types.js"

/** A wire in a workflow that can't work with the nodes it connects. */
export interface WiringIssue {
  nodeId: string
  /** `uses`, `in.<input>`, `in`, `values.<input>` or `when`. */
  field: string
  message: string
}

/**
 * Checks a workflow against its nodes' schemas, so a mistake fails the build
 * instead of answering 500 at request time:
 * - `uses` names a node file that exists (a renamed file breaks it);
 * - every input in `in`/`values` exists on the node, and every required
 *   input is wired;
 * - every reference reads an output field the referenced node declares.
 *
 * Schemas that aren't plain objects, or allow unknown keys, aren't checked.
 */
export function checkWiring(
  workflow: WorkflowFile,
  resolve: (uses: string) => AnyNodeOrTrigger | null,
): WiringIssue[] {
  const issues: WiringIssue[] = []
  const defs = new Map<string, AnyNodeOrTrigger | null>()
  for (const [id, inst] of Object.entries(workflow.nodes)) defs.set(id, resolve(inst.uses))

  const checkRef = (nodeId: string, field: string, raw: string) => {
    const ref = parseReference(raw)
    if (!ref || ref.path.length === 0) return
    const target = defs.get(ref.nodeId)
    const source = workflow.nodes[ref.nodeId]
    if (source && canonicalCoreId(source.uses) === "@core/switch") {
      const branches = switchOutputs(source.values?.cases)
      if (branches.includes(ref.path[0]!)) return
      issues.push({
        nodeId,
        field,
        message: `\`${raw}\` reads output \`${ref.path[0]}\`, but ${ref.nodeId} has no such output (outputs: ${branches.join(", ")})`,
      })
      return
    }
    const shape = target ? objectShape(target.outputs) : null
    if (!shape || ref.path[0]! in shape) return
    issues.push({
      nodeId,
      field,
      message: `\`${raw}\` reads output \`${ref.path[0]}\`, but ${ref.nodeId} has no such output (outputs: ${keysOf(shape)})`,
    })
  }

  for (const [id, inst] of Object.entries(workflow.nodes)) {
    const def = defs.get(id)
    if (!def) {
      issues.push({
        nodeId: id,
        field: "uses",
        message: `\`${inst.uses}\` doesn't match a node file; if you renamed or moved it, update \`uses\``,
      })
      continue
    }

    if (typeof inst.in === "string") {
      checkRef(id, "in", inst.in)
    } else {
      for (const [key, raw] of Object.entries(inst.in ?? {})) {
        if (typeof raw === "string") checkRef(id, `in.${key}`, raw)
      }
    }
    if (inst.when !== undefined) {
      const when = parseWhen(inst.when)
      if (when) checkRef(id, "when", inst.when.replace(/^!/, ""))
    }

    // Input names only apply to nodes; a trigger's `values` are its config.
    if (def.kind !== "node" || typeof inst.in === "string") continue
    const inputs = objectShape(def.inputs)
    if (!inputs) continue
    for (const [source, keys] of [
      ["in", Object.keys(inst.in ?? {})],
      ["values", Object.keys(inst.values ?? {})],
    ] as const) {
      for (const key of keys) {
        if (!(key in inputs))
          issues.push({
            nodeId: id,
            field: `${source}.${key}`,
            message: `${id} (${inst.uses}) has no input \`${key}\` (inputs: ${keysOf(inputs)})`,
          })
      }
    }
    const wired = new Set([...Object.keys(inst.in ?? {}), ...Object.keys(inst.values ?? {})])
    for (const [key, schema] of Object.entries(inputs)) {
      if (wired.has(key) || acceptsUndefined(schema)) continue
      issues.push({
        nodeId: id,
        field: `in.${key}`,
        message: `${id} needs input \`${key}\`, but nothing is wired to it in \`in\` or \`values\``,
      })
    }
  }
  return issues
}

interface ZodLike {
  safeParse(value: unknown): { success: boolean }
  _zod?: { def?: { type?: string; catchall?: { _zod?: { def?: { type?: string } } } } }
  shape?: Record<string, ZodLike>
}

/** The fields of a plain z.object (strict or stripping); null for anything else. */
function objectShape(schema: unknown): Record<string, ZodLike> | null {
  const s = schema as ZodLike | undefined
  const def = s?._zod?.def
  if (def?.type !== "object" || !s?.shape) return null
  const catchall = def.catchall?._zod?.def?.type
  if (catchall !== undefined && catchall !== "never") return null
  return s.shape
}

function acceptsUndefined(schema: ZodLike): boolean {
  try {
    return schema.safeParse(undefined).success
  } catch {
    return true
  }
}

function keysOf(shape: Record<string, unknown>): string {
  const keys = Object.keys(shape)
  return keys.length > 0 ? keys.join(", ") : "none"
}

/** A switch's outputs: one `caseN` per case, then `default` and `value`. */
function switchOutputs(cases: unknown): string[] {
  const n = Array.isArray(cases) ? cases.length : 0
  return [...Array.from({ length: n }, (_, i) => `case${i + 1}`), "default", "value"]
}
