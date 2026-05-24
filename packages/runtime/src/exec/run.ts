import type { AnyNodeOrTrigger, Node, Services } from "../types.js"
import { parseReference } from "../workflow/reference.js"
import type { WorkflowFile } from "../workflow/types.js"
import { NodeRunError } from "./errors.js"
import type { LifecycleEmitter } from "./lifecycle.js"
import type { ExecutionPlan } from "./topology.js"

export interface WorkflowRunResult {
  status: number
  body: unknown
  headers: Record<string, string>
}

export interface RunWorkflowOptions {
  workflow: WorkflowFile
  plan: ExecutionPlan
  /** Which trigger node fired this run. */
  triggerNodeId: string
  /** The outputs of the trigger node, pre-resolved by the host (HTTP request data, etc.). */
  triggerOutputs: Record<string, unknown>
  services: Services
  /** Maps a node's `uses` string to its Node/Trigger object. */
  resolveNode: (uses: string) => AnyNodeOrTrigger | null
  lifecycle?: LifecycleEmitter
  /**
   * Optional async hook called immediately after Zod input validation, before
   * the node's `run()` executes. Dev-only (the debugger uses this to pause).
   * If undefined, the interpreter does not await anything here — zero overhead.
   * If the returned promise rejects, the rejection is wrapped in a
   * `NodeRunError` and the workflow halts per existing fail-fast semantics.
   */
  onBeforeNode?: (nodeId: string, input: Record<string, unknown>) => Promise<void>
  /**
   * Optional async hook called immediately after a node's `run()` returns,
   * after the corresponding `after-node` lifecycle event has been emitted,
   * before downstream nodes can consume the output. Not called when `run()`
   * throws (use lifecycle `error` events for that). Not called for
   * @core/response (which short-circuits without `outputs.set`).
   */
  onAfterNode?: (nodeId: string, output: Record<string, unknown>) => Promise<void>
}

/**
 * Compute the set of nodes that must execute when `triggerNodeId` fires.
 *
 * A node's "trigger owners" are the triggers from which it is forward-reachable.
 * - Nodes owned by the firing trigger run (they're downstream of it).
 * - Nodes with no trigger owners (orphans) also run — there is no other
 *   trigger claiming them, and they are typically required to compute outputs.
 * - Nodes owned exclusively by *other* triggers are skipped (multi-trigger
 *   workflows: don't cross-fire between independent subgraphs).
 *
 * Additionally, we include the transitive upstream ancestors of every
 * already-included node, so a downstream node's data dependencies are always
 * satisfied even when they live in an orphan subgraph.
 */
function computeExecutionSet(
  workflow: WorkflowFile,
  plan: ExecutionPlan,
  triggerNodeId: string,
): Set<string> {
  const allIds = Object.keys(workflow.nodes)
  const ownersOf = new Map<string, Set<string>>()
  for (const id of allIds) ownersOf.set(id, new Set())
  for (const [trigId, reach] of plan.reachableFrom) {
    for (const id of reach) ownersOf.get(id)?.add(trigId)
  }

  const execSet = new Set<string>()
  for (const id of allIds) {
    const owners = ownersOf.get(id) ?? new Set()
    if (owners.has(triggerNodeId) || owners.size === 0) execSet.add(id)
  }
  execSet.add(triggerNodeId)

  // Build deps adjacency to walk upstream ancestors.
  const depsOf = new Map<string, Set<string>>()
  for (const [id, inst] of Object.entries(workflow.nodes)) {
    const deps = new Set<string>()
    if (inst.in !== undefined) {
      if (typeof inst.in === "string") {
        const ref = parseReference(inst.in)
        if (ref) deps.add(ref.nodeId)
      } else {
        for (const raw of Object.values(inst.in)) {
          if (typeof raw !== "string") continue
          const ref = parseReference(raw)
          if (ref) deps.add(ref.nodeId)
        }
      }
    }
    if (inst.after) {
      for (const t of inst.after) deps.add(t)
    }
    depsOf.set(id, deps)
  }

  // Foreign triggers: every trigger in the workflow that ISN'T the firing one.
  // The execution-plan's `reachableFrom` keys are exactly the trigger nodes
  // discovered by topology.ts; anything keyed there but not equal to the
  // firing trigger is "another trigger's entrypoint" and must be excluded
  // from this run — including from the ancestor walk below. This preserves
  // the spec's "each trigger's run is independent" semantics: ancestor walking
  // from a shared downstream node must not pull a sibling trigger (and its
  // subgraph) into the execution set.
  const foreignTriggers = new Set<string>()
  for (const trigId of plan.reachableFrom.keys()) {
    if (trigId !== triggerNodeId) foreignTriggers.add(trigId)
  }

  // BFS upstream from every reachable node to include all transitive ancestors,
  // skipping foreign triggers (and not recursing into their ancestors).
  const queue: string[] = [...execSet]
  while (queue.length > 0) {
    const cur = queue.shift() as string
    for (const dep of depsOf.get(cur) ?? []) {
      if (foreignTriggers.has(dep)) continue
      if (!execSet.has(dep)) {
        execSet.add(dep)
        queue.push(dep)
      }
    }
  }

  return execSet
}

export async function runWorkflow(opts: RunWorkflowOptions): Promise<WorkflowRunResult> {
  const { workflow, plan, triggerNodeId, triggerOutputs, lifecycle } = opts

  const startedAt = Date.now()
  const outputs = new Map<string, Record<string, unknown>>()
  outputs.set(triggerNodeId, triggerOutputs)

  const execSet = computeExecutionSet(workflow, plan, triggerNodeId)

  let responseResult: WorkflowRunResult | null = null

  for (const wave of plan.waves) {
    const tasks: Promise<void>[] = []
    for (const nodeId of wave) {
      if (!execSet.has(nodeId)) continue
      if (nodeId === triggerNodeId) {
        lifecycle?.emit({ type: "before-node", nodeId, input: {} })
        if (opts.onBeforeNode) {
          try {
            await opts.onBeforeNode(nodeId, {})
          } catch (err) {
            throw new NodeRunError(nodeId, err)
          }
        }
        lifecycle?.emit({ type: "after-node", nodeId, output: triggerOutputs as Record<string, unknown>, durationMs: 0 })
        if (opts.onAfterNode) {
          try {
            await opts.onAfterNode(nodeId, triggerOutputs as Record<string, unknown>)
          } catch (err) {
            throw new NodeRunError(nodeId, err)
          }
        }
        continue
      }
      tasks.push(
        runOneNode(nodeId, opts, outputs, lifecycle).then((res) => {
          if (res?.kind === "response") responseResult = res.value
        }),
      )
    }
    if (tasks.length > 0) {
      // Per spec §3.5: "If any node throws, the workflow halts. In-flight
      // sibling nodes are awaited (so dispose()s run on services) but their
      // results are discarded." Promise.all would reject fast and leave
      // siblings as unhandled rejections; allSettled awaits all, then we
      // rethrow the first failure.
      const settled = await Promise.allSettled(tasks)
      const rejection = settled.find((s) => s.status === "rejected")
      if (rejection) throw (rejection as PromiseRejectedResult).reason
    }
    if (responseResult) break
  }

  lifecycle?.emit({ type: "complete", totalMs: Date.now() - startedAt })

  if (responseResult) return responseResult
  return { status: 200, body: null, headers: {} }
}

interface RunNodeResult {
  kind: "response"
  value: WorkflowRunResult
}

async function runOneNode(
  nodeId: string,
  opts: RunWorkflowOptions,
  outputs: Map<string, Record<string, unknown>>,
  lifecycle: LifecycleEmitter | undefined,
): Promise<RunNodeResult | null> {
  const instance = opts.workflow.nodes[nodeId]
  if (!instance) return null
  const nodeDef = opts.resolveNode(instance.uses)
  if (!nodeDef) {
    throw new NodeRunError(nodeId, new Error(`unresolved \`uses\`: ${instance.uses}`))
  }

  // Resolve inputs. The shape is:
  //  - `values:` provides the literal floor (per-field, JSON-serializable).
  //  - `in: "ref"`    → resolved value REPLACES the whole input bag (whole-object form).
  //  - `in: {...}`    → per-field reference strings; each overrides values[field].
  //
  // Precedence for a given field, in order from lowest to highest:
  //   instance.values[field] < instance.in[field] (reference, resolved)
  // The whole-object form replaces everything, so `values` is ignored when
  // `in` is a string.
  let input: Record<string, unknown> = {}
  if (typeof instance.in === "string") {
    const ref = parseReference(instance.in)
    if (!ref) {
      throw new NodeRunError(
        nodeId,
        new Error(
          `whole-object \`in\` must be a node reference, got: ${JSON.stringify(instance.in)}`,
        ),
      )
    }
    const upstream = outputs.get(ref.nodeId)
    if (!upstream) {
      throw new NodeRunError(
        nodeId,
        new Error(`upstream \`${ref.nodeId}\` produced no output`),
      )
    }
    let v: unknown = upstream
    for (const seg of ref.path) {
      v = (v as Record<string, unknown> | null | undefined)?.[seg]
    }
    // The resolved value IS the input bag. If it's not an object, Zod will fail
    // shortly — we don't want to coerce here.
    input = (v ?? {}) as Record<string, unknown>
    lifecycle?.emit({
      type: "edge-fired",
      from: `${ref.nodeId}.${ref.path.join(".")}`,
      to: `${nodeId}.$`,
      value: v,
    })
  } else {
    // 1) Start with literal values from `values:` (the floor).
    if (instance.values && typeof instance.values === "object") {
      for (const [k, v] of Object.entries(instance.values)) {
        input[k] = v
      }
    }
    // 2) Overlay per-field references from `in:`.
    for (const [field, raw] of Object.entries(instance.in ?? {})) {
      const ref = parseReference(raw)
      if (!ref) {
        throw new NodeRunError(
          nodeId,
          new Error(`\`in.${field}\` must be a node reference, got: ${JSON.stringify(raw)}`),
        )
      }
      const upstream = outputs.get(ref.nodeId)
      if (!upstream) {
        throw new NodeRunError(
          nodeId,
          new Error(`upstream \`${ref.nodeId}\` produced no output`),
        )
      }
      let v: unknown = upstream
      for (const seg of ref.path) {
        v = (v as Record<string, unknown> | null | undefined)?.[seg]
      }
      input[field] = v
      lifecycle?.emit({
        type: "edge-fired",
        from: `${ref.nodeId}.${ref.path.join(".")}`,
        to: `${nodeId}.${field}`,
        value: v,
      })
    }
  }

  // Special-case @core/response: collect status/body/headers and short-circuit.
  if (instance.uses === "@core/response") {
    lifecycle?.emit({ type: "before-node", nodeId, input })
    if (opts.onBeforeNode) {
      try {
        await opts.onBeforeNode(nodeId, input)
      } catch (err) {
        throw new NodeRunError(nodeId, err)
      }
    }
    const response: WorkflowRunResult = {
      status: (input.status as number | undefined) ?? 200,
      body: input.body,
      headers: (input.headers as Record<string, string> | undefined) ?? {},
    }
    lifecycle?.emit({
      type: "after-node",
      nodeId,
      output: { sent: true },
      durationMs: 0,
    })
    // onAfterNode is intentionally NOT called for @core/response — no outputs exposed downstream.
    return { kind: "response", value: response }
  }

  if (nodeDef.kind !== "node") {
    // Non-response trigger nodes are already handled in runWorkflow.
    return null
  }

  // Validate the resolved input bag against the node's Zod schema before run().
  let validatedInput: Record<string, unknown> = input
  if (nodeDef.inputs) {
    const result = (nodeDef as Node).inputs.safeParse(input)
    if (!result.success) {
      const issue = result.error.issues[0]
      const path = issue?.path?.join(".") ?? "<root>"
      const message = issue?.message ?? "validation failed"
      throw new NodeRunError(
        nodeId,
        new Error(`input validation failed at \`${path}\`: ${message}`),
      )
    }
    validatedInput = result.data as Record<string, unknown>
  }

  lifecycle?.emit({ type: "before-node", nodeId, input: validatedInput })
  if (opts.onBeforeNode) {
    try {
      await opts.onBeforeNode(nodeId, validatedInput)
    } catch (err) {
      throw new NodeRunError(nodeId, err)
    }
  }
  const t0 = Date.now()
  let output: Record<string, unknown>
  try {
    output = (await (nodeDef as Node).run(
      validatedInput as never,
      opts.services,
      undefined as never,
    )) as Record<string, unknown>
  } catch (err) {
    lifecycle?.emit({ type: "error", nodeId, error: err as Error })
    throw new NodeRunError(nodeId, err)
  }
  lifecycle?.emit({
    type: "after-node",
    nodeId,
    output,
    durationMs: Date.now() - t0,
  })
  if (opts.onAfterNode) {
    try {
      await opts.onAfterNode(nodeId, output)
    } catch (err) {
      throw new NodeRunError(nodeId, err)
    }
  }
  outputs.set(nodeId, output)
  return null
}
