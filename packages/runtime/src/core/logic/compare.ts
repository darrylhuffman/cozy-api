/**
 * The comparisons behind the logic nodes. Kept free of zod and the runtime so
 * the build's codegen can mirror them line for line (see emit-workflow's
 * renderLogicHelpers); change both together.
 */

export const IF_OPERATORS = [
  "is truthy",
  "is falsy",
  "==",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "contains",
  "starts with",
  "ends with",
  "is empty",
  "is not empty",
  "exists",
] as const

export type IfOperator = (typeof IF_OPERATORS)[number]

/** `value` itself, or the attribute at a dotted `field` path inside it ("user.role"). */
export function pickField(value: unknown, field: string | undefined): unknown {
  if (!field) return value
  let v: unknown = value
  for (const seg of field.split(".")) {
    if (seg === "") continue
    v = v !== null && typeof v === "object" ? (v as Record<string, unknown>)[seg] : undefined
  }
  return v
}

function isPrimitive(v: unknown): v is string | number | boolean | bigint {
  return (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    typeof v === "bigint"
  )
}

/**
 * Equality for case values: strict, except that primitives compare by their
 * text (a query string "2" matches the case 2) and objects and arrays compare
 * by content.
 */
export function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (isPrimitive(a) && isPrimitive(b)) return String(a) === String(b)
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every((k) =>
    looseEquals((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === "object") return Object.keys(v).length === 0
  return false
}

/** Orders two values: numerically when both read as numbers, otherwise as text. */
function order(a: unknown, b: unknown): number {
  const na = typeof a === "string" && a.trim() === "" ? Number.NaN : Number(a)
  const nb = typeof b === "string" && b.trim() === "" ? Number.NaN : Number(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  const sa = String(a)
  const sb = String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

/** Whether `left <operator> right` holds. An unknown operator reads as "is truthy". */
export function testCondition(
  left: unknown,
  operator: string | undefined,
  right: unknown,
): boolean {
  switch (operator) {
    case "is falsy":
      return !left
    case "==":
      return looseEquals(left, right)
    case "!=":
      return !looseEquals(left, right)
    case ">":
      return left != null && right != null && order(left, right) > 0
    case ">=":
      return left != null && right != null && order(left, right) >= 0
    case "<":
      return left != null && right != null && order(left, right) < 0
    case "<=":
      return left != null && right != null && order(left, right) <= 0
    case "contains":
      if (typeof left === "string") return left.includes(String(right))
      if (Array.isArray(left)) return left.some((item) => looseEquals(item, right))
      if (left !== null && typeof left === "object") return String(right) in left
      return false
    case "starts with":
      return typeof left === "string" && left.startsWith(String(right))
    case "ends with":
      return typeof left === "string" && left.endsWith(String(right))
    case "is empty":
      return isEmpty(left)
    case "is not empty":
      return !isEmpty(left)
    case "exists":
      return left !== undefined && left !== null
    default:
      return Boolean(left)
  }
}

/** The switch's outputs: `case1`…`caseN` and `default`, exactly one of them true. */
export function switchBranches(
  value: unknown,
  field: string | undefined,
  cases: readonly unknown[] | undefined,
): Record<string, boolean> {
  const subject = pickField(value, field)
  const out: Record<string, boolean> = {}
  let matched = false
  ;(cases ?? []).forEach((c, i) => {
    const hit = !matched && looseEquals(subject, c)
    if (hit) matched = true
    out[`case${i + 1}`] = hit
  })
  out.default = !matched
  return out
}
