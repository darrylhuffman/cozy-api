import type {
  Assertion,
  AssertionOp,
  AssertionTarget,
  EnvironmentsFile,
  RequestBody,
  RequestCollection,
  SavedRequest,
} from "./types.js"

const TARGETS: AssertionTarget[] = ["status", "header", "body", "duration"]
const OPS: AssertionOp[] = [
  "equals",
  "notEquals",
  "contains",
  "exists",
  "notExists",
  "matches",
  "lessThan",
  "greaterThan",
  "type",
]

export class RequestFileError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = [message],
  ) {
    super(message)
    this.name = "RequestFileError"
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

function stringMap(
  v: unknown,
  where: string,
  problems: string[],
): Record<string, string> | undefined {
  if (v === undefined) return undefined
  if (!isObj(v)) {
    problems.push(`${where} must be an object of strings`)
    return undefined
  }
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string") out[k] = val
    else if (typeof val === "number" || typeof val === "boolean") out[k] = String(val)
    else problems.push(`${where}.${k} must be a string`)
  }
  return out
}

function parseBody(v: unknown, where: string, problems: string[]): RequestBody | undefined {
  if (v === undefined) return undefined
  if (!isObj(v) || typeof v.kind !== "string") {
    problems.push(`${where} must be { kind, ... }`)
    return undefined
  }
  switch (v.kind) {
    case "json":
      return { kind: "json", json: v.json }
    case "text":
    case "xml":
      if (typeof v.text !== "string") {
        problems.push(`${where}.text must be a string`)
        return undefined
      }
      return { kind: v.kind, text: v.text }
    case "form":
      return { kind: "form", form: stringMap(v.form ?? {}, `${where}.form`, problems) ?? {} }
    default:
      problems.push(`${where}.kind must be json, text, xml or form`)
      return undefined
  }
}

function parseAssertion(v: unknown, where: string, problems: string[]): Assertion | null {
  if (!isObj(v)) {
    problems.push(`${where} must be an object`)
    return null
  }
  if (!TARGETS.includes(v.target as AssertionTarget)) {
    problems.push(`${where}.target must be one of ${TARGETS.join(", ")}`)
    return null
  }
  if (!OPS.includes(v.op as AssertionOp)) {
    problems.push(`${where}.op must be one of ${OPS.join(", ")}`)
    return null
  }
  if (v.path !== undefined && typeof v.path !== "string") {
    problems.push(`${where}.path must be a string`)
    return null
  }
  const a: Assertion = { target: v.target as AssertionTarget, op: v.op as AssertionOp }
  if (typeof v.path === "string") a.path = v.path
  if ("value" in v) a.value = v.value
  return a
}

export function parseSavedRequest(
  v: unknown,
  where: string,
  problems: string[],
): SavedRequest | null {
  if (!isObj(v)) {
    problems.push(`${where} must be an object`)
    return null
  }
  const before = problems.length
  for (const key of ["id", "name", "method", "path"] as const) {
    if (typeof v[key] !== "string" || (v[key] as string).length === 0) {
      problems.push(`${where}.${key} must be a non-empty string`)
    }
  }
  if (problems.length > before) return null
  const req: SavedRequest = {
    id: v.id as string,
    name: v.name as string,
    method: (v.method as string).toUpperCase(),
    path: v.path as string,
  }
  if (typeof v.trigger === "string") req.trigger = v.trigger
  const query = stringMap(v.query, `${where}.query`, problems)
  if (query) req.query = query
  const headers = stringMap(v.headers, `${where}.headers`, problems)
  if (headers) req.headers = headers
  const body = parseBody(v.body, `${where}.body`, problems)
  if (body) req.body = body
  if (v.expect !== undefined) {
    if (!Array.isArray(v.expect)) problems.push(`${where}.expect must be an array`)
    else
      req.expect = v.expect
        .map((a, i) => parseAssertion(a, `${where}.expect[${i}]`, problems))
        .filter((a): a is Assertion => a !== null)
  }
  const capture = stringMap(v.capture, `${where}.capture`, problems)
  if (capture) req.capture = capture
  return req
}

/** Parses and validates a `*.requests.json` file. Throws RequestFileError listing every problem. */
export function parseRequestCollection(text: string, file = "requests file"): RequestCollection {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new RequestFileError(`${file} is not valid JSON: ${(e as Error).message}`)
  }
  if (!isObj(raw) || !Array.isArray(raw.requests)) {
    throw new RequestFileError(`${file} must be an object with a "requests" array`)
  }
  const problems: string[] = []
  const requests = raw.requests
    .map((r, i) => parseSavedRequest(r, `requests[${i}]`, problems))
    .filter((r): r is SavedRequest => r !== null)
  const seen = new Set<string>()
  for (const r of requests) {
    if (seen.has(r.id)) problems.push(`duplicate request id "${r.id}"`)
    seen.add(r.id)
  }
  if (problems.length > 0) {
    throw new RequestFileError(
      `${file}: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}`,
      problems,
    )
  }
  return { lorien: 1, requests }
}

export function parseEnvironments(text: string, file = "environments file"): EnvironmentsFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new RequestFileError(`${file} is not valid JSON: ${(e as Error).message}`)
  }
  if (!isObj(raw) || !isObj(raw.environments)) {
    throw new RequestFileError(`${file} must be an object with an "environments" object`)
  }
  const problems: string[] = []
  const environments: Record<string, Record<string, string>> = {}
  for (const [name, vars] of Object.entries(raw.environments)) {
    environments[name] = stringMap(vars, `environments.${name}`, problems) ?? {}
  }
  if (problems.length > 0) throw new RequestFileError(`${file}: ${problems[0]}`, problems)
  const out: EnvironmentsFile = { lorien: 1, environments }
  if (typeof raw.default === "string") out.default = raw.default
  return out
}

/** Local overrides win variable-by-variable; environments only in the local file are added. */
export function mergeEnvironments(
  shared: EnvironmentsFile | null,
  local: EnvironmentsFile | null,
): EnvironmentsFile {
  const environments: Record<string, Record<string, string>> = {}
  for (const src of [shared, local]) {
    for (const [name, vars] of Object.entries(src?.environments ?? {})) {
      environments[name] = { ...environments[name], ...vars }
    }
  }
  const out: EnvironmentsFile = { lorien: 1, environments }
  const def = local?.default ?? shared?.default
  if (def) out.default = def
  return out
}

export function serializeCollection(c: RequestCollection): string {
  return `${JSON.stringify(c, null, 2)}\n`
}

/** `workflows/users/create.workflow` → `workflows/users/create.requests.json` */
export function collectionPathFor(workflowPath: string): string {
  return `${workflowPath.replace(/\.workflow$/, "")}.requests.json`
}
