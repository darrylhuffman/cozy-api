import type { ParsedReference } from "./types.js"

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
 * Returns true when `value` is a string that parses as a node reference.
 * Used by code that needs a yes/no answer; for the parsed shape, call
 * `parseReference` directly.
 */
export function isReferenceString(value: unknown): value is string {
  return typeof value === "string" && parseReference(value) !== null
}
