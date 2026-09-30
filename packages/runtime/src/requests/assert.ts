import { readPath } from "./path.js"
import type { Assertion, AssertionResult, ResponseSnapshot, RunTrace } from "./types.js"

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]))
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  return (
    ka.length === kb.length &&
    ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  )
}

/** `expected` is a subset of `actual`: every key/element it lists matches. */
function isSubset(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return deepEqual(actual, expected)
  if (actual === null || typeof actual !== "object") return false
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false
    return expected.every((e) => actual.some((a) => isSubset(a, e)))
  }
  return Object.entries(expected as Record<string, unknown>).every(([k, v]) =>
    isSubset((actual as Record<string, unknown>)[k], v),
  )
}

export function typeOf(v: unknown): string {
  if (v === null) return "null"
  if (Array.isArray(v)) return "array"
  return typeof v
}

function show(v: unknown): string {
  if (v === undefined) return "nothing"
  const s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)
  return s === undefined ? String(v) : s.length > 120 ? `${s.slice(0, 117)}...` : s
}

export function describeAssertion(a: Assertion): string {
  if (a.target === "node" && !a.path && (a.op === "exists" || a.op === "notExists")) {
    return `${a.node ?? "?"} ${a.op === "exists" ? "ran" : "did not run"}`
  }
  const subject =
    a.target === "node"
      ? `${a.node ?? "?"}${a.path ? ` ${a.path}` : ""}`
      : a.target === "status"
        ? "status"
        : a.target === "duration"
          ? "duration (ms)"
          : a.target === "header"
            ? `header ${a.path ?? ""}`
            : a.path
              ? `body.${a.path}`
              : "body"
  const verb: Record<Assertion["op"], string> = {
    equals: "equals",
    notEquals: "does not equal",
    contains: "contains",
    exists: "exists",
    notExists: "does not exist",
    matches: "matches",
    lessThan: "is less than",
    greaterThan: "is greater than",
    type: "is of type",
  }
  return a.op === "exists" || a.op === "notExists"
    ? `${subject} ${verb[a.op]}`
    : `${subject} ${verb[a.op]} ${show(a.value)}`
}

function subjectOf(
  a: Assertion,
  res: ResponseSnapshot,
  trace: RunTrace | undefined,
): { found: boolean; value: unknown } {
  switch (a.target) {
    case "node": {
      const entry = a.node ? trace?.nodes[a.node] : undefined
      if (!entry) return { found: false, value: undefined }
      return a.path ? readPath(entry, a.path) : { found: true, value: entry }
    }
    case "status":
      return { found: true, value: res.status }
    case "duration":
      return { found: true, value: res.durationMs }
    case "header": {
      const name = (a.path ?? "").toLowerCase()
      const key = Object.keys(res.headers).find((k) => k.toLowerCase() === name)
      return key === undefined
        ? { found: false, value: undefined }
        : { found: true, value: res.headers[key] }
    }
    case "body":
      return readPath(res.body, a.path)
  }
}

/** Options for {@link evaluateAssertion}. */
export interface EvaluateOptions {
  /**
   * The server is known not to record traces (a built server), so node checks
   * are skipped instead of failed.
   */
  skipNodeChecks?: boolean
}

/**
 * Checks one assertion. `node` checks read `trace`; without one they fail and
 * say why, or are skipped when the server can't record traces.
 */
export function evaluateAssertion(
  a: Assertion,
  res: ResponseSnapshot,
  trace?: RunTrace,
  opts: EvaluateOptions = {},
): AssertionResult {
  if (a.target === "node" && !trace) {
    if (opts.skipNodeChecks) {
      const skipped = "this server doesn't record traces"
      return {
        assertion: a,
        pass: true,
        actual: undefined,
        skipped,
        message: `${describeAssertion(a)}: skipped, ${skipped}`,
      }
    }
    return {
      assertion: a,
      pass: false,
      actual: undefined,
      message: `${describeAssertion(a)}: the server sent no trace with its ${res.status} response. Node checks need the dev server (the IDE, \`lorien dev\` or \`lorien test\`) and a route that handled the request`,
    }
  }
  const { found, value } = subjectOf(a, res, trace)
  let pass: boolean
  let problem: string | null = null
  switch (a.op) {
    case "exists":
      pass = found && value !== undefined
      break
    case "notExists":
      pass = !found || value === undefined
      break
    case "equals":
      // Headers are strings; let `status: 201` style numbers compare loosely.
      pass =
        found &&
        (deepEqual(value, a.value) || (typeof value === "string" && value === String(a.value)))
      break
    case "notEquals":
      pass = !deepEqual(value, a.value)
      break
    case "contains":
      pass =
        found &&
        (typeof value === "string" ? value.includes(String(a.value)) : isSubset(value, a.value))
      break
    case "matches": {
      try {
        pass =
          found &&
          new RegExp(String(a.value)).test(
            typeof value === "string" ? value : JSON.stringify(value),
          )
      } catch (e) {
        pass = false
        problem = `invalid pattern: ${(e as Error).message}`
      }
      break
    }
    case "lessThan":
      pass = found && Number(value) < Number(a.value)
      break
    case "greaterThan":
      pass = found && Number(value) > Number(a.value)
      break
    case "type":
      pass = found && typeOf(value) === a.value
      break
    default:
      pass = false
      problem = `unknown operator "${String((a as { op: unknown }).op)}"`
  }
  const expected = describeAssertion(a)
  const message = pass
    ? expected
    : problem
      ? `${expected}: ${problem}`
      : a.target === "node" && !a.path
        ? `expected ${expected}, but it ${found ? "ran" : "never ran"}`
        : `expected ${expected}, got ${found ? show(value) : "nothing"}`
  return { assertion: a, pass, actual: value, message }
}

export function evaluateAssertions(
  list: Assertion[] | undefined,
  res: ResponseSnapshot,
  trace?: RunTrace,
  opts: EvaluateOptions = {},
): AssertionResult[] {
  return (list ?? []).map((a) => evaluateAssertion(a, res, trace, opts))
}
