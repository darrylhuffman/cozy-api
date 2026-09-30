const VAR_RE = /\{\{\s*([$\w.-]+)\s*\}\}/g

export interface InterpolationContext {
  vars: Record<string, string>
  /** Collects names that had no value. */
  missing?: Set<string>
}

function dynamic(name: string): string | undefined {
  switch (name) {
    case "$uuid":
      return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
    case "$timestamp":
      return String(Date.now())
    case "$isoTimestamp":
      return new Date().toISOString()
    case "$randomInt":
      return String(Math.floor(Math.random() * 1_000_000))
    default:
      return undefined
  }
}

/**
 * Replaces `{{name}}` with `vars[name]`. Built-ins: `{{$uuid}}`,
 * `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`. Unknown names are
 * left in place and recorded in `ctx.missing`.
 */
export function interpolate(text: string, ctx: InterpolationContext): string {
  return text.replace(VAR_RE, (whole, name: string) => {
    const v = name.startsWith("$") ? dynamic(name) : ctx.vars[name]
    if (v === undefined) {
      ctx.missing?.add(name)
      return whole
    }
    return v
  })
}

/** Interpolates every string inside a JSON value. */
export function interpolateDeep(value: unknown, ctx: InterpolationContext): unknown {
  if (typeof value === "string") return interpolate(value, ctx)
  if (Array.isArray(value)) return value.map((v) => interpolateDeep(v, ctx))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        interpolateDeep(v, ctx),
      ]),
    )
  }
  return value
}

const WHOLE_VAR_RE = /^\{\{\s*[$\w.-]+\s*\}\}$/

/**
 * Interpolates an expected value in a check. A string that is only a
 * variable (`"{{bookId}}"`) takes the variable's JSON value, so a captured
 * number still equals the number in the response body.
 */
export function interpolateExpected(value: unknown, ctx: InterpolationContext): unknown {
  if (typeof value === "string" && WHOLE_VAR_RE.test(value)) {
    const text = interpolate(value, ctx)
    if (text === value) return value
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  if (typeof value === "string") return interpolate(value, ctx)
  if (Array.isArray(value)) return value.map((v) => interpolateExpected(v, ctx))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        interpolateExpected(v, ctx),
      ]),
    )
  }
  return value
}

/** Variable names referenced by a string (excluding `$` built-ins). */
export function referencedVariables(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(VAR_RE)) {
    if (!m[1]!.startsWith("$")) out.add(m[1]!)
  }
  return [...out]
}
