import type { NodeCase } from "@darrylondil/lorien-runtime/cases"
import type { JsonSchema, WorkflowFile } from "@/lib/api"
import type { RunRecord } from "@/store/debug-session"
import { sampleFromSchema } from "../run-tab/sample-from-schema"

/** What the case editor edits: the case with its JSON fields as text. */
export interface CaseDraft {
  id: string
  name: string
  input: string
  mocks: string
  mode: "contains" | "equals" | "error"
  output: string
  error: string
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2)

export function draftFromCase(c: NodeCase): CaseDraft {
  const mode =
    c.expect.error !== undefined ? "error" : c.expect.match === "equals" ? "equals" : "contains"
  return {
    id: c.id,
    name: c.name,
    input: pretty(c.input),
    mocks: c.mocks ? pretty(c.mocks) : "",
    mode,
    output: c.expect.output === undefined ? "" : pretty(c.expect.output),
    error: c.expect.error ?? "",
  }
}

export function newDraft(id: string, inputSchema: JsonSchema | undefined): CaseDraft {
  const sample = sampleFromSchema(inputSchema)
  return {
    id,
    name: "",
    input: pretty(sample && typeof sample === "object" ? sample : {}),
    mocks: "",
    mode: "contains",
    output: "",
    error: "",
  }
}

function parseJson(label: string, text: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(text) }
  } catch (e) {
    return { error: `${label} is not valid JSON: ${(e as Error).message}` }
  }
}

export function caseFromDraft(
  d: CaseDraft,
): { case: NodeCase; error?: undefined } | { case?: undefined; error: string } {
  if (!d.name.trim()) return { error: "Give the case a name." }
  const input = parseJson("Input", d.input.trim() || "{}")
  if (input.error) return { error: input.error }
  if (!input.value || typeof input.value !== "object" || Array.isArray(input.value))
    return { error: "Input must be a JSON object." }
  const c: NodeCase = {
    id: d.id,
    name: d.name.trim(),
    input: input.value as Record<string, unknown>,
    expect: {},
  }
  if (d.mocks.trim()) {
    const mocks = parseJson("Mocks", d.mocks)
    if (mocks.error) return { error: mocks.error }
    c.mocks = mocks.value as NonNullable<NodeCase["mocks"]>
  }
  if (d.mode === "error") c.expect = { error: d.error }
  else if (d.output.trim()) {
    const out = parseJson("Expected output", d.output)
    if (out.error) return { error: out.error }
    c.expect = d.mode === "equals" ? { output: out.value, match: "equals" } : { output: out.value }
  }
  return { case: c }
}

/**
 * The most recent debug run of this workflow that reached a node using
 * `uses`: its input, and its output or error — ready to become a case.
 */
export function lastRunOf(
  runs: RunRecord[],
  workflow: WorkflowFile | null,
  workflowPath: string,
  uses: string,
): { nodeId: string; input: Record<string, unknown>; output?: unknown; error?: string } | null {
  if (!workflow) return null
  const ids = new Set(
    Object.entries(workflow.nodes)
      .filter(([, n]) => n.uses === uses)
      .map(([id]) => id),
  )
  if (ids.size === 0) return null
  const samePath = (p: string) =>
    p === workflowPath || p.endsWith(`/${workflowPath}`) || workflowPath.endsWith(p)
  for (const run of runs) {
    if (!samePath(run.workflowPath)) continue
    // A sub-workflow node runs as its nodes: its input is what its Input
    // received, its output what its Output handed back.
    const groupOf = (nodeId: string, role: "input" | "output") => {
      const origin = run.origins?.[nodeId]
      return origin?.role === role && origin.frames.length === 2
        ? (origin.frames[0]?.nodeId ?? null)
        : null
    }
    for (let i = run.events.length - 1; i >= 0; i--) {
      const ev = run.events[i]!.event
      if (ev.type !== "before-node") continue
      const group = groupOf(ev.nodeId, "input")
      const nodeId = ids.has(ev.nodeId) ? ev.nodeId : group && ids.has(group) ? group : null
      if (!nodeId) continue
      const after = run.events.slice(i + 1).map((e) => e.event)
      const done = after.find((e) =>
        e.type !== "after-node"
          ? false
          : nodeId === ev.nodeId
            ? e.nodeId === ev.nodeId
            : groupOf(e.nodeId, "output") === nodeId,
      )
      const failed = after.find(
        (e) => e.type === "error" && (e.nodeId === ev.nodeId || e.nodeId.startsWith(`${nodeId}__`)),
      )
      if (done?.type === "after-node") return { nodeId, input: ev.input, output: done.output }
      if (failed?.type === "error") return { nodeId, input: ev.input, error: failed.error.message }
    }
  }
  return null
}

export function draftFromRun(
  id: string,
  run: NonNullable<ReturnType<typeof lastRunOf>>,
): CaseDraft {
  return {
    id,
    name: run.error ? `Fails like the last run` : `Matches the last run`,
    input: pretty(run.input),
    mocks: "",
    mode: run.error !== undefined ? "error" : "equals",
    output: run.output === undefined ? "" : pretty(run.output),
    error: run.error ?? "",
  }
}
