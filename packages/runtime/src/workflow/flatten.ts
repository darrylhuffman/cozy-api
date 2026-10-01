import { nodeDependencies, parseWhen } from "./dependencies.js"
import { parseReference } from "./reference.js"
import type { NodeInstance, ParsedReference, WorkflowFile } from "./types.js"

/** A sub-workflow: a `.workflow` file under `nodes/`, used like a node. */
export interface Subworkflow {
  /** How workflows refer to it, e.g. "./nodes/orders/reserve-seats". */
  uses: string
  /** Project-relative path, e.g. "nodes/orders/reserve-seats.workflow". */
  relativePath: string
  file: WorkflowFile
}

/** Sub-workflows by their `uses` key. */
export type SubworkflowMap = Record<string, Subworkflow>

export const SUBWORKFLOW_INPUT = "@core/input"
export const SUBWORKFLOW_OUTPUT = "@core/output"

/**
 * Joins a sub-workflow node's id to the ids of the nodes inside it once it is
 * flattened: `ReserveSeats` + `FindEvent` → `ReserveSeats__FindEvent`.
 */
export const SUBWORKFLOW_SEPARATOR = "__"

/** A sub-workflow node that can't be flattened into its workflow. */
export class SubworkflowError extends Error {
  constructor(
    public readonly nodeId: string,
    public readonly field: string,
    message: string,
  ) {
    super(message)
    this.name = "SubworkflowError"
  }
}

/** The `uses` key for a sub-workflow file: "nodes/a/b.workflow" → "./nodes/a/b". */
export function subworkflowUses(relativePath: string): string {
  return `./${relativePath.replaceAll("\\", "/").replace(/\.workflow$/, "")}`
}

/** Where a sub-workflow's ports live: its Input and Output node ids, either may be absent. */
export function subworkflowPorts(file: WorkflowFile): {
  inputId: string | null
  outputId: string | null
  inputs: Record<string, unknown>
  outputs: string[]
} {
  const ids = (uses: string) =>
    Object.entries(file.nodes)
      .filter(([, inst]) => inst.uses === uses)
      .map(([id]) => id)
  const [inputId = null] = ids(SUBWORKFLOW_INPUT)
  const [outputId = null] = ids(SUBWORKFLOW_OUTPUT)
  const fields = inputId ? file.nodes[inputId]?.values?.fields : undefined
  const inputs =
    fields && typeof fields === "object" && !Array.isArray(fields)
      ? (fields as Record<string, unknown>)
      : {}
  const outMap = outputId ? file.nodes[outputId]?.in : undefined
  const outputs = outMap && typeof outMap === "object" ? Object.keys(outMap) : []
  return { inputId, outputId, inputs, outputs }
}

/**
 * Replaces every sub-workflow node with the nodes inside it, so the workflow
 * can run (or be built) like any other. The inner nodes are renamed
 * `<SubWorkflowNode>__<InnerNode>`. Its Input and Output stay in the graph as
 * pass-through nodes, which is what makes the sub-workflow behave like one
 * node:
 * - the node's `in`/`values` move onto the Input, and its `when` and `after`
 *   onto the Input and the inner nodes that read nothing, so when the node
 *   doesn't run, nothing inside it does;
 * - reads of `<SubWorkflowNode>.<output>` become reads of the Output, so they
 *   are skipped when the Output is skipped (all outputs or none);
 * - a Response inside answers the request, as it would in the caller.
 *
 * Nested sub-workflows are flattened too. Throws `SubworkflowError` when a
 * node can't be flattened (unknown ports, a cycle, a clashing id).
 */
export function flattenWorkflow(
  wf: WorkflowFile,
  subworkflows: SubworkflowMap,
  stack: string[] = [],
): WorkflowFile {
  const groups = Object.entries(wf.nodes).filter(([, inst]) => subworkflows[inst.uses])
  if (groups.length === 0) return wf

  const out: Record<string, NodeInstance> = {}
  // Sub-workflow node id → its Output node id once flattened (null: no outputs),
  // its output names, and every node id it flattened into.
  const outputOf = new Map<string, { id: string | null; names: Set<string>; all: string[] }>()

  for (const [id, inst] of Object.entries(wf.nodes)) {
    const sub = subworkflows[inst.uses]
    if (!sub) {
      out[id] = inst
      continue
    }
    if (stack.includes(inst.uses)) {
      throw new SubworkflowError(
        id,
        "uses",
        `\`${inst.uses}\` uses itself: ${[...stack, inst.uses].join(" -> ")}`,
      )
    }
    const inner = flattenWorkflow(sub.file, subworkflows, [...stack, inst.uses])
    // Ports and checks read the file as written: once flattened, a nested
    // sub-workflow's Input and Output are in it too.
    const ports = subworkflowPorts(sub.file)
    const name = `${id} (${sub.relativePath})`

    if (Object.values(sub.file.nodes).some((n) => n.uses === "@core/http-request")) {
      throw new SubworkflowError(
        id,
        "uses",
        `${name} has an HTTP Request trigger; a sub-workflow starts at an Input node instead`,
      )
    }
    for (const uses of [SUBWORKFLOW_INPUT, SUBWORKFLOW_OUTPUT]) {
      if (Object.values(sub.file.nodes).filter((n) => n.uses === uses).length > 1) {
        throw new SubworkflowError(id, "uses", `${name} has more than one \`${uses}\` node`)
      }
    }
    if (typeof inst.in === "string") {
      throw new SubworkflowError(
        id,
        "in",
        `wire ${id}'s inputs one by one; a sub-workflow node can't take its whole input from one reference`,
      )
    }
    for (const [source, keys] of [
      ["in", Object.keys(inst.in ?? {})],
      ["values", Object.keys(inst.values ?? {})],
    ] as const) {
      for (const key of keys) {
        if (!(key in ports.inputs)) {
          throw new SubworkflowError(
            id,
            `${source}.${key}`,
            `${name} has no input \`${key}\` (inputs: ${Object.keys(ports.inputs).join(", ") || "none"})`,
          )
        }
      }
    }

    const prefix = `${id}${SUBWORKFLOW_SEPARATOR}`
    const all: string[] = []
    const isConstant = (innerId: string) => inner.nodes[innerId]?.uses === "@core/variable"
    for (const [innerId, n] of Object.entries(inner.nodes)) {
      const newId = prefix + innerId
      if (wf.nodes[newId]) {
        throw new SubworkflowError(
          newId,
          "uses",
          `node id \`${newId}\` clashes with a node from sub-workflow ${name}; rename one of them`,
        )
      }
      all.push(newId)
      if (innerId === ports.inputId) {
        // The caller's wiring, read in the caller's scope.
        out[newId] = {
          uses: SUBWORKFLOW_INPUT,
          ...(inst.in ? { in: { ...inst.in } } : {}),
          ...(inst.values ? { values: { ...inst.values } } : {}),
          ...(inst.when !== undefined ? { when: inst.when } : {}),
          ...(inst.after ? { after: [...inst.after] } : {}),
        }
        continue
      }
      const moved = prefixRefs(n, prefix)
      // A node that reads nothing from inside runs whether or not the
      // sub-workflow node does; give it the node's conditions.
      const reads = nodeDependencies(n).filter((d) => !isConstant(d))
      if (reads.length === 0 && n.uses !== "@core/variable") {
        if (inst.when !== undefined) {
          if (moved.when !== undefined) {
            throw new SubworkflowError(
              id,
              "when",
              `${id} has a run condition, but ${innerId} in ${sub.relativePath} reads nothing from its Input and has its own; wire ${innerId} to the Input so the condition can reach it`,
            )
          }
          moved.when = inst.when
        }
        if (inst.after) moved.after = [...(moved.after ?? []), ...inst.after]
      }
      out[newId] = moved
    }
    outputOf.set(id, {
      id: ports.outputId ? prefix + ports.outputId : null,
      names: new Set(ports.outputs),
      all,
    })
  }

  // Reads of a sub-workflow node's outputs, in the caller's scope, now read its Output.
  const redirect = (nodeId: string, field: string, raw: string): string => {
    const neg = raw.startsWith("!")
    const ref = parseReference(neg ? raw.slice(1) : raw)
    const target = ref ? outputOf.get(ref.nodeId) : undefined
    if (!ref || !target) return raw
    const [port, ...rest] = ref.path
    if (!target.id || port === undefined || !target.names.has(port)) {
      const has = [...target.names].join(", ") || "none"
      throw new SubworkflowError(
        nodeId,
        field,
        port === undefined
          ? `read one of ${ref.nodeId}'s outputs (${has}), not the whole sub-workflow`
          : `\`${raw}\` reads output \`${port}\`, but sub-workflow ${ref.nodeId} has no such output (outputs: ${has})`,
      )
    }
    return `${neg ? "!" : ""}${[target.id, port, ...rest].join(".")}`
  }
  for (const [id, inst] of Object.entries(out)) {
    let changed: NodeInstance | null = null
    const edit = () => {
      changed ??= { ...inst }
      return changed
    }
    if (typeof inst.in === "string") {
      const v = redirect(id, "in", inst.in)
      if (v !== inst.in) edit().in = v
    } else if (inst.in) {
      const next: Record<string, string> = {}
      let moved = false
      for (const [field, raw] of Object.entries(inst.in)) {
        next[field] = redirect(id, `in.${field}`, raw)
        if (next[field] !== raw) moved = true
      }
      if (moved) edit().in = next
    }
    if (inst.when !== undefined) {
      const v = redirect(id, "when", inst.when)
      if (v !== inst.when) edit().when = v
    }
    if (inst.after?.some((a) => outputOf.has(a))) {
      // Waiting for a sub-workflow node means waiting for everything in it.
      edit().after = [...new Set(inst.after.flatMap((a) => outputOf.get(a)?.all ?? [a]))]
    }
    if (changed) out[id] = changed
  }

  const view = wf.view
    ? Object.fromEntries(Object.entries(wf.view).filter(([id]) => out[id]))
    : undefined
  return { ...wf, nodes: out, ...(view ? { view } : {}) }
}

/** A copy of an inner node with every node id it references prefixed. */
function prefixRefs(inst: NodeInstance, prefix: string): NodeInstance {
  const fix = (raw: string) => {
    const neg = raw.startsWith("!")
    return parseReference(neg ? raw.slice(1) : raw)
      ? `${neg ? "!" : ""}${prefix}${neg ? raw.slice(1) : raw}`
      : raw
  }
  const next: NodeInstance = { ...inst }
  if (typeof inst.in === "string") next.in = fix(inst.in)
  else if (inst.in)
    next.in = Object.fromEntries(Object.entries(inst.in).map(([k, v]) => [k, fix(v)]))
  if (inst.when !== undefined && parseWhen(inst.when)) next.when = fix(inst.when)
  if (inst.after) next.after = inst.after.map((a) => prefix + a)
  return next
}

/**
 * Follows a reference back through flattened sub-workflow ports to where the
 * value comes from: `Reserve__Input.quantity`, with the Input wired to
 * `Request.body.quantity`, is `Request.body.quantity`. Used to answer 400 for
 * a bad request value that reached a node inside a sub-workflow.
 */
export function referenceSource(wf: WorkflowFile, raw: string): ParsedReference | null {
  let ref = parseReference(raw)
  for (let hops = 0; ref && hops < 64; hops++) {
    const inst = wf.nodes[ref.nodeId]
    if (!inst || (inst.uses !== SUBWORKFLOW_INPUT && inst.uses !== SUBWORKFLOW_OUTPUT)) return ref
    const [port, ...rest] = ref.path
    const wired = port !== undefined && typeof inst.in === "object" ? inst.in[port] : undefined
    const next = wired !== undefined ? parseReference(wired) : null
    if (!next) return ref
    ref = { nodeId: next.nodeId, path: [...next.path, ...rest] }
  }
  return ref
}
