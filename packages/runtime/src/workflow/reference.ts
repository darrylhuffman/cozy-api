import type { ParsedReference, ResolvedInputValue } from "./types.js"

const IDENT = /^[a-zA-Z_$][\w$]*$/
const REFERENCE = /^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*$/

/**
 * Parses a reference string of the form "nodeId" or "nodeId.path.to.field".
 * Returns null if the input doesn't match the reference grammar.
 */
export function parseReference(input: string): ParsedReference | null {
  if (!REFERENCE.test(input)) return null
  const [nodeId, ...path] = input.split(".")
  if (!nodeId || !IDENT.test(nodeId)) return null
  for (const seg of path) {
    if (!IDENT.test(seg)) return null
  }
  return { nodeId, path }
}

/**
 * Decides whether an `in` value is a reference (to resolve at runtime) or a literal.
 * Strings that match the reference grammar are references; everything else is a literal.
 * The {$literal: x} escape wraps literal values that would otherwise be parsed as references.
 */
export function resolveInputValue(value: unknown): ResolvedInputValue {
  // Explicit literal escape: { $literal: <anything> } unwraps to literal.
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "$literal" in value &&
    Object.keys(value as object).length === 1
  ) {
    return { kind: "literal", value: (value as { $literal: unknown }).$literal }
  }

  if (typeof value === "string") {
    const ref = parseReference(value)
    if (ref) return { kind: "reference", ref }
  }

  return { kind: "literal", value }
}
