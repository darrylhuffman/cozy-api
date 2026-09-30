import {
  casesPathFor,
  type NodeCase,
  type NodeCaseResult,
  nodeFileForUses,
} from "@darrylondil/lorien-runtime/cases"
import {
  collectionPathFor,
  type RequestRunResult,
  type SavedRequest,
} from "@darrylondil/lorien-runtime/requests"
import type { NodeSchemas, WorkflowFile } from "@/lib/api"
import type { RunRecord } from "@/store/debug-session"
import type { Diagnostic } from "@/workflow/diagnose"

/**
 * What an "Ask AI" action sends: a short headline the chat shows as the
 * message, and the context (paths, schemas, errors, formats) folded under it.
 */
export interface AiRequest {
  title: string
  headline: string
  context: string[]
}

/** Separates the headline from the context in the sent text; the chat folds what follows. */
export const CONTEXT_MARKER = "\n\n--- context from the lorien IDE ---\n"

export function renderPrompt(r: AiRequest): string {
  return r.context.length === 0
    ? r.headline
    : `${r.headline}${CONTEXT_MARKER}${r.context.join("\n\n")}`
}

export function splitPrompt(text: string): { headline: string; context: string | null } {
  const at = text.indexOf(CONTEXT_MARKER)
  return at === -1
    ? { headline: text, context: null }
    : { headline: text.slice(0, at), context: text.slice(at + CONTEXT_MARKER.length) }
}

const json = (v: unknown) => JSON.stringify(v, null, 2)
const block = (label: string, v: unknown) => `${label}:\n\`\`\`json\n${json(v)}\n\`\`\``
const clip = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}\n… (truncated)` : s)

export const CASES_FORMAT = `Node test cases live next to the node as <node>.cases.json:
{ "lorien": 1, "cases": [ { "id": "camelCaseId", "name": "What should happen",
  "input": { ...node inputs... },
  "mocks": { "<service>": { "<method>": { "returns": <value> } | { "throws": "message" } } },   (optional; replaces that service)
  "expect": { "output": { ...subset of the output... } }  or  { "output": ..., "match": "equals" }  or  { "error": "text the message contains" } } ] }
Input is validated against the node's inputs schema first. Run them with \`lorien test <path fragment>\`.`

export const REQUESTS_FORMAT = `Saved API requests live next to the workflow as <workflow>.requests.json:
{ "lorien": 1, "requests": [ { "id": "camelCaseId", "name": "What it checks", "trigger": "<http-request node id>",
  "method": "POST", "path": "/users", "query": {}, "headers": {},
  "body": { "kind": "json", "json": { ... } },   (or { "kind": "text"|"xml", "text": "..." } or { "kind": "form", "form": {} })
  "expect": [ { "target": "status"|"header"|"body"|"duration", "path": "user.id", "op": "equals"|"notEquals"|"contains"|"exists"|"notExists"|"matches"|"lessThan"|"greaterThan"|"type", "value": ... } ],
  "capture": { "userId": "body.user.id" },
  "mocks": { "<node id>": { "output": { ... } } | { "error": "message" } } } ] }
Step checks use "target": "node" with "node": "<node id>" and a "path" into what it did: "input.name", "output.user.id" or "error"; with no path, "exists" means the node ran and "notExists" that it never ran.
Mocks make a node return that output (or throw) without running its code, for that request only: use them for paths that are hard to reach for real, like a database failure.
Strings may use {{variables}} from lorien.environments.json, values captured by earlier requests, or {{$uuid}}, {{$timestamp}}, {{$randomInt}}.
Run them with \`lorien test <path fragment>\`.`

function workflowContext(workflowPath: string, workflow: WorkflowFile | null): string {
  return workflow ? `${block(`Workflow ${workflowPath}`, workflow)}` : `Workflow: ${workflowPath}`
}

function schemaContext(uses: string, schema: NodeSchemas | undefined): string[] {
  if (!schema) return []
  return [block(`Schemas for ${uses}`, { inputs: schema.inputs, outputs: schema.outputs })]
}

export function explainNode(p: {
  workflowPath: string
  workflow: WorkflowFile | null
  nodeId: string
  uses: string
  schema: NodeSchemas | undefined
}): AiRequest {
  const file = nodeFileForUses(p.uses)
  return {
    title: `Explain ${p.nodeId}`,
    headline: `Explain what the ${p.nodeId} node does in ${p.workflowPath}: its inputs, what it produces, which services it uses, and anything surprising or risky. Don't change any files.`,
    context: [
      file ? `Node source: ${file}` : `Built-in node: ${p.uses}`,
      ...schemaContext(p.uses, p.schema),
      workflowContext(p.workflowPath, p.workflow),
    ],
  }
}

export function generateCases(p: {
  uses: string
  schema: NodeSchemas | undefined
  existing: NodeCase[]
}): AiRequest {
  const file = nodeFileForUses(p.uses) ?? p.uses
  const casesPath = casesPathFor(file)
  return {
    title: `Test cases for ${p.schema?.name ?? file}`,
    headline: `Write test cases for ${file} in ${casesPath}. Read the node first. Cover the main success path, input validation, edge cases, and failures from its services (mock them). Keep the existing cases, then run \`lorien test ${casesPath}\` and fix any case that is wrong about the node's behaviour. If a case exposes a real bug in the node, tell me instead of changing the node.`,
    context: [
      `Node source: ${file}`,
      ...schemaContext(p.uses, p.schema),
      p.existing.length > 0
        ? block(`Existing cases in ${casesPath}`, p.existing)
        : `${casesPath} does not exist yet.`,
      CASES_FORMAT,
    ],
  }
}

export function fixFailingCase(p: {
  uses: string
  testCase: NodeCase
  result: NodeCaseResult
}): AiRequest {
  const file = nodeFileForUses(p.uses) ?? p.uses
  return {
    title: `Fix "${p.testCase.name}"`,
    headline: `The test case "${p.testCase.name}" for ${file} fails. Work out whether the node or the case is wrong, fix the right one, and re-run \`lorien test ${casesPathFor(file)}\`.`,
    context: [
      block("Case", p.testCase),
      block("Result", {
        failures: p.result.failures,
        output: p.result.output,
        error: p.result.error,
      }),
      CASES_FORMAT,
    ],
  }
}

export function generateRequests(p: {
  workflowPath: string
  workflow: WorkflowFile | null
  existing: SavedRequest[]
  schemas: Record<string, NodeSchemas>
}): AiRequest {
  const path = collectionPathFor(p.workflowPath)
  const used = new Set(Object.values(p.workflow?.nodes ?? {}).map((n) => n.uses))
  const schemas = Object.fromEntries(
    [...used]
      .filter((u) => p.schemas[u])
      .map((u) => [u, { inputs: p.schemas[u]!.inputs, outputs: p.schemas[u]!.outputs }]),
  )
  return {
    title: `Requests for ${p.workflowPath.split("/").pop()}`,
    headline: `Write saved API requests for ${p.workflowPath} in ${path}: the happy path and the important failures (bad input, missing fields, anything the nodes reject), each with checks on status and the response body. Keep the existing requests, then run \`lorien test ${path}\` and fix requests whose expectations are wrong. If a request exposes a real bug, tell me instead of changing the workflow.`,
    context: [
      workflowContext(p.workflowPath, p.workflow),
      Object.keys(schemas).length > 0 ? block("Node schemas", schemas) : "",
      p.existing.length > 0
        ? block(`Existing requests in ${path}`, p.existing)
        : `${path} does not exist yet.`,
      REQUESTS_FORMAT,
    ].filter(Boolean),
  }
}

export function explainRequestFailure(p: {
  workflowPath: string
  workflow: WorkflowFile | null
  result: RequestRunResult
}): AiRequest {
  return {
    title: `Why did ${p.result.name === "scratch" ? "this request" : `"${p.result.name}"`} fail?`,
    headline: `This request to ${p.workflowPath} didn't do what was expected. Find out why and fix the workflow or its nodes if they're wrong; if the request's expectations are wrong, say so.`,
    context: [
      block("Request", p.result.request),
      block("Response", p.result.response ?? { error: p.result.error }),
      p.result.assertions.length > 0
        ? `Checks:\n${p.result.assertions.map((a) => `${a.pass ? "✓" : "✗"} ${a.message}`).join("\n")}`
        : "",
      workflowContext(p.workflowPath, p.workflow),
    ].filter(Boolean),
  }
}

export function fixFailedRun(p: {
  run: RunRecord
  workflow: WorkflowFile | null
}): AiRequest | null {
  const out = p.run.outcome
  if (out.kind !== "errored") return null
  const nodeId = out.nodeId
  const inputEv = nodeId
    ? [...p.run.events]
        .reverse()
        .find((e) => e.event.type === "before-node" && e.event.nodeId === nodeId)
    : undefined
  const uses = nodeId ? p.workflow?.nodes[nodeId]?.uses : undefined
  const file = uses ? nodeFileForUses(uses) : null
  const logs = p.run.logs.map((l) => `[${l.level}] ${l.message}`).join("\n")
  return {
    title: nodeId ? `Fix ${nodeId} failure` : "Fix failed run",
    headline: `A debug run of ${p.run.workflowPath} failed${nodeId ? ` in ${nodeId}` : ""}: ${out.message}. Find the cause and fix it${file ? ` (the node's source is ${file})` : ""}. Explain the fix briefly.`,
    context: [
      block("Request", p.run.request),
      inputEv && inputEv.event.type === "before-node"
        ? block(`Input to ${nodeId}`, inputEv.event.input)
        : "",
      out.stack ? `Stack:\n${clip(out.stack, 2500)}` : "",
      logs ? `Logs:\n${clip(logs, 2500)}` : "",
      workflowContext(p.run.workflowPath, p.workflow),
    ].filter(Boolean),
  }
}

export function fixProblems(p: {
  workflowPath: string
  workflow: WorkflowFile | null
  diagnostics: Diagnostic[]
}): AiRequest {
  return {
    title: `Fix problems in ${p.workflowPath.split("/").pop()}`,
    headline: `The IDE reports ${p.diagnostics.length} problem${p.diagnostics.length === 1 ? "" : "s"} in ${p.workflowPath}. Fix them in the workflow file (or the nodes, if that's where the mistake is).`,
    context: [
      `Problems:\n${p.diagnostics.map((d) => `- [${d.severity}]${d.nodeId ? ` ${d.nodeId}:` : ""} ${d.message}`).join("\n")}`,
      workflowContext(p.workflowPath, p.workflow),
    ],
  }
}

export function freeform(p: {
  ask: string
  workflowPath: string | null
  workflow: WorkflowFile | null
  selected: { nodeId: string; uses: string; schema: NodeSchemas | undefined } | null
}): AiRequest {
  const ctx: string[] = []
  if (p.selected) {
    const file = nodeFileForUses(p.selected.uses)
    ctx.push(`Selected node: ${p.selected.nodeId} (${file ?? p.selected.uses})`)
    ctx.push(...schemaContext(p.selected.uses, p.selected.schema))
  }
  if (p.workflowPath) ctx.push(workflowContext(p.workflowPath, p.workflow))
  return { title: p.ask.slice(0, 60), headline: p.ask, context: ctx }
}
