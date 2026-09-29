/**
 * Node test cases: `nodes/users/save-user.cases.json` sits next to
 * `nodes/users/save-user.ts` and lists inputs with the output (or error) each
 * should produce. Services can be replaced with canned mocks per case.
 *
 * Browser-safe: the IDE uses these types and helpers; running a case needs the
 * node's code and lives in `@darrylondil/lorien-runtime/testing`.
 */
import { deepEqual } from "../requests/assert.js"

export const CASES_SUFFIX = ".cases.json"

/** `{ "returns": value }` resolves, `{ "throws": "message" }` rejects. */
export type MockFn = { returns?: unknown; throws?: string }

export interface CaseExpectation {
  /** Expected output. Compared as a subset unless `match` is "equals". */
  output?: unknown
  match?: "contains" | "equals"
  /** The run must fail and its message must contain this text ("" = any error). */
  error?: string
}

export interface NodeCase {
  id: string
  name: string
  input: Record<string, unknown>
  /** Per service, per method canned results. A mocked service replaces the real one. */
  mocks?: Record<string, Record<string, MockFn>>
  expect: CaseExpectation
}

export interface NodeCaseFile {
  lorien: 1
  cases: NodeCase[]
}

export interface NodeCaseResult {
  caseId: string
  name: string
  passed: boolean
  output?: unknown
  /** Error thrown by the node (or input validation). */
  error?: string
  /** Why the case failed; empty when it passed. */
  failures: string[]
  durationMs: number
}

export class CaseFileError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = [message],
  ) {
    super(message)
    this.name = "CaseFileError"
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** `nodes/users/save-user.ts` → `nodes/users/save-user.cases.json` */
export function casesPathFor(nodePath: string): string {
  return `${nodePath.replace(/\.ts$/, "")}${CASES_SUFFIX}`
}

/** `./nodes/users/save-user` (a workflow's `uses`) → `nodes/users/save-user.ts` */
export function nodeFileForUses(uses: string): string | null {
  return uses.startsWith("./") ? `${uses.slice(2)}.ts` : null
}

export function parseCaseFile(text: string, file = "cases file"): NodeCaseFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new CaseFileError(`${file} is not valid JSON: ${(e as Error).message}`)
  }
  if (!isObj(raw) || !Array.isArray(raw.cases)) {
    throw new CaseFileError(`${file} must be an object with a "cases" array`)
  }
  const problems: string[] = []
  const cases: NodeCase[] = []
  const seen = new Set<string>()
  raw.cases.forEach((c, i) => {
    const where = `cases[${i}]`
    if (!isObj(c)) {
      problems.push(`${where} must be an object`)
      return
    }
    const before = problems.length
    for (const k of ["id", "name"] as const) {
      if (typeof c[k] !== "string" || c[k] === "")
        problems.push(`${where}.${k} must be a non-empty string`)
    }
    if (!isObj(c.input)) problems.push(`${where}.input must be an object`)
    if (!isObj(c.expect)) problems.push(`${where}.expect must be an object`)
    else {
      if (c.expect.error !== undefined && typeof c.expect.error !== "string")
        problems.push(`${where}.expect.error must be a string`)
      if (
        c.expect.match !== undefined &&
        c.expect.match !== "contains" &&
        c.expect.match !== "equals"
      )
        problems.push(`${where}.expect.match must be "contains" or "equals"`)
    }
    if (c.mocks !== undefined) {
      if (!isObj(c.mocks)) problems.push(`${where}.mocks must be an object`)
      else
        for (const [svc, methods] of Object.entries(c.mocks)) {
          if (!isObj(methods)) {
            problems.push(
              `${where}.mocks.${svc} must map method names to { returns } or { throws }`,
            )
            continue
          }
          for (const [m, spec] of Object.entries(methods)) {
            if (!isObj(spec) || (!("returns" in spec) && typeof spec.throws !== "string"))
              problems.push(
                `${where}.mocks.${svc}.${m} must be { "returns": value } or { "throws": "message" }`,
              )
          }
        }
    }
    if (problems.length > before) return
    if (seen.has(c.id as string)) problems.push(`duplicate case id "${c.id}"`)
    seen.add(c.id as string)
    cases.push(c as unknown as NodeCase)
  })
  if (problems.length > 0) {
    throw new CaseFileError(
      `${file}: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}`,
      problems,
    )
  }
  return { lorien: 1, cases }
}

export function serializeCaseFile(f: NodeCaseFile): string {
  return `${JSON.stringify(f, null, 2)}\n`
}

function isSubset(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return deepEqual(actual, expected)
  if (actual === null || typeof actual !== "object") return false
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((e, i) => isSubset(actual[i], e))
    )
  }
  return Object.entries(expected as Record<string, unknown>).every(([k, v]) =>
    isSubset((actual as Record<string, unknown>)[k], v),
  )
}

const show = (v: unknown) => {
  const s = JSON.stringify(v)
  return s === undefined ? String(v) : s.length > 200 ? `${s.slice(0, 197)}...` : s
}

/** Compares what a run produced with what the case expects. */
export function judgeCase(
  expect: CaseExpectation,
  outcome: { output?: unknown; error?: string },
): string[] {
  if (expect.error !== undefined) {
    if (outcome.error === undefined)
      return [
        `expected an error${expect.error ? ` containing "${expect.error}"` : ""}, but it returned ${show(outcome.output)}`,
      ]
    if (!outcome.error.includes(expect.error))
      return [`expected an error containing "${expect.error}", got "${outcome.error}"`]
    return []
  }
  if (outcome.error !== undefined) return [`threw: ${outcome.error}`]
  if (expect.output === undefined) return []
  const ok =
    expect.match === "equals"
      ? deepEqual(outcome.output, expect.output)
      : isSubset(outcome.output, expect.output)
  return ok
    ? []
    : [
        `expected output ${expect.match === "equals" ? "to equal" : "to contain"} ${show(expect.output)}, got ${show(outcome.output)}`,
      ]
}
