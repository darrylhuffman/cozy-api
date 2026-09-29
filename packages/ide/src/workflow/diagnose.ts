import type { JsonSchema, NodeSchemas, WorkflowFile } from "@/lib/api"

export type Severity = "error" | "warning"

export interface Diagnostic {
  /** Stable key for React lists. */
  key: string
  severity: Severity
  /** Node the problem is attached to; null for workflow-level problems. */
  nodeId: string | null
  /** Input field / `after` / `id` the problem concerns, when there is one. */
  field?: string
  message: string
}

const IDENT = /^[a-zA-Z_$][\w$]*$/
const TRIGGERS = new Set(["@core/http-request"])
const RESPONSE = "@core/response"

export function isValidNodeId(id: string): boolean {
  return IDENT.test(id)
}

/**
 * Static checks for a workflow, run live in the editor. Mirrors the runtime's
 * load-time validation (bad references, unknown nodes, cycles) and adds
 * schema-aware checks the runtime only discovers mid-request: unknown node
 * types, references to outputs that don't exist, and required inputs that are
 * never provided.
 *
 * `schemasLoaded` gates the schema-aware checks so a slow introspection pass
 * doesn't flash "unknown node" on every card.
 */
export function diagnoseWorkflow(
  wf: WorkflowFile,
  schemas: Record<string, NodeSchemas>,
  opts: { schemasLoaded: boolean },
): Diagnostic[] {
  const out: Diagnostic[] = []
  const push = (d: Omit<Diagnostic, "key">) =>
    out.push({ ...d, key: `${d.nodeId ?? "*"}|${d.field ?? ""}|${d.message}` })
  const ids = Object.keys(wf.nodes)
  const deps = new Map<string, Set<string>>()

  for (const [nodeId, node] of Object.entries(wf.nodes)) {
    const nodeDeps = new Set<string>()
    deps.set(nodeId, nodeDeps)

    if (!isValidNodeId(nodeId)) {
      push({
        severity: "error",
        nodeId,
        field: "id",
        message: `"${nodeId}" is not a valid node id, so other nodes can't reference it. Rename it (letters, digits, _ or $; no hyphens).`,
      })
    }

    const schema = schemas[node.uses]
    if (opts.schemasLoaded && !schema) {
      push({
        severity: "error",
        nodeId,
        message: node.uses.startsWith("./")
          ? `Node file for "${node.uses}" is missing or failed to load.`
          : `Unknown node type "${node.uses}".`,
      })
    }

    const checkRef = (raw: unknown, field: string) => {
      if (typeof raw !== "string") {
        push({
          severity: "error",
          nodeId,
          field,
          message: `Input "${field}" must be a reference string.`,
        })
        return
      }
      const [sourceId, ...path] = raw.split(".")
      if (!sourceId || !wf.nodes[sourceId]) {
        push({
          severity: "error",
          nodeId,
          field,
          message: `Input "${field}" references unknown node "${sourceId ?? raw}".`,
        })
        return
      }
      if (sourceId === nodeId) {
        push({
          severity: "error",
          nodeId,
          field,
          message: `Input "${field}" references its own node.`,
        })
        return
      }
      if (!IDENT.test(sourceId) || path.some((seg) => !IDENT.test(seg))) {
        push({
          severity: "error",
          nodeId,
          field,
          message: `"${raw}" is not a valid reference (segments must be identifiers).`,
        })
        return
      }
      nodeDeps.add(sourceId)
      const sourceSchema = schemas[wf.nodes[sourceId]!.uses]
      if (opts.schemasLoaded && sourceSchema) {
        const missing = missingPathSegment(sourceSchema.outputs, path)
        if (missing) {
          push({
            severity: "warning",
            nodeId,
            field,
            message: `"${raw}": "${missing.segment}" is not an output of ${[sourceId, ...missing.parent].join(".")}.`,
          })
        }
      }
    }

    if (typeof node.in === "string") checkRef(node.in, "input")
    else if (node.in) for (const [field, raw] of Object.entries(node.in)) checkRef(raw, field)

    for (const target of node.after ?? []) {
      if (!wf.nodes[target]) {
        push({
          severity: "error",
          nodeId,
          field: "after",
          message: `"after" lists unknown node "${target}".`,
        })
      } else {
        nodeDeps.add(target)
      }
    }

    // Required inputs that nothing provides fail zod validation at run time.
    if (opts.schemasLoaded && schema && typeof node.in !== "string") {
      const props = schema.inputs.properties ?? {}
      const required = Array.isArray(schema.inputs.required)
        ? (schema.inputs.required as string[])
        : []
      for (const field of required) {
        const provided =
          (node.in !== undefined && field in node.in) ||
          (node.values !== undefined && field in node.values) ||
          props[field]?.default !== undefined
        if (!provided) {
          push({
            severity: "error",
            nodeId,
            field,
            message: `Required input "${field}" is not connected and has no value.`,
          })
        }
      }
    }
  }

  const cycle = findCycle(ids, deps)
  if (cycle) {
    push({
      severity: "error",
      nodeId: cycle[0]!,
      message: `Cycle: ${cycle.join(" → ")}. A node can't depend on its own output.`,
    })
  }

  if (ids.length > 0) {
    const uses = ids.map((id) => wf.nodes[id]!.uses)
    const hasTrigger = uses.some((u) => TRIGGERS.has(u))
    if (!hasTrigger) {
      push({
        severity: "warning",
        nodeId: null,
        message: "No HTTP Request trigger: nothing can call this workflow.",
      })
    } else if (!uses.includes(RESPONSE)) {
      push({
        severity: "warning",
        nodeId: null,
        message: "No Response node: requests will never get an answer.",
      })
    }
  }

  return out
}

/**
 * Walks `path` through an outputs schema. Returns the first segment that the
 * schema positively rules out; paths into opaque values (no declared
 * properties, or open additionalProperties) are assumed fine.
 */
function missingPathSegment(
  schema: JsonSchema | undefined,
  path: string[],
): { segment: string; parent: string[] } | null {
  let current = schema
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]!
    if (!current || current.type !== "object" || !current.properties) return null
    if (current.additionalProperties !== undefined && current.additionalProperties !== false)
      return null
    const next = current.properties[seg]
    if (!next) return { segment: seg, parent: path.slice(0, i) }
    current = next
  }
  return null
}

function findCycle(ids: string[], deps: Map<string, Set<string>>): string[] | null {
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []
  const visit = (id: string): string[] | null => {
    const s = state.get(id)
    if (s === 2) return null
    if (s === 1) return [...stack.slice(stack.indexOf(id)), id]
    state.set(id, 1)
    stack.push(id)
    for (const dep of deps.get(id) ?? []) {
      const found = visit(dep)
      if (found) return found
    }
    stack.pop()
    state.set(id, 2)
    return null
  }
  for (const id of ids) {
    const found = visit(id)
    if (found) return found
  }
  return null
}

/** Groups diagnostics by node id for badge rendering. */
export function diagnosticsByNode(diags: Diagnostic[]): Map<string, Diagnostic[]> {
  const m = new Map<string, Diagnostic[]>()
  for (const d of diags) {
    if (!d.nodeId) continue
    const list = m.get(d.nodeId) ?? []
    list.push(d)
    m.set(d.nodeId, list)
  }
  return m
}
