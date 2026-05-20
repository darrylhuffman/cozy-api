import type { OpenAPIObject } from "./load-spec.js"
import { OpenAPIError } from "./load-spec.js"

/**
 * Resolves a JSON-pointer-style ref like `#/components/schemas/Pet`.
 * Throws on external refs (don't start with `#`), missing paths, or cycles.
 */
export function resolveRef(
  spec: OpenAPIObject,
  ref: string,
  seen: Set<string> = new Set(),
): unknown {
  if (!ref.startsWith("#")) {
    throw new OpenAPIError(
      `External refs are not supported in v1 (got "${ref}"). Inline the schema or use a tool to flatten the spec first.`,
    )
  }
  if (seen.has(ref)) {
    throw new OpenAPIError(`Cycle detected in $ref chain: ${[...seen, ref].join(" -> ")}`)
  }
  const nextSeen = new Set(seen)
  nextSeen.add(ref)

  const segments = ref
    .slice(1)
    .split("/")
    .filter((s) => s.length > 0)
  let cur: unknown = spec
  for (const seg of segments) {
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[decodeJsonPointerSegment(seg)]
    } else {
      throw new OpenAPIError(`Cannot resolve ref ${ref}: segment "${seg}" reached a non-object`)
    }
    if (cur === undefined) {
      throw new OpenAPIError(`Cannot resolve ref ${ref}: missing at segment "${seg}"`)
    }
  }

  // If the resolved value is itself a $ref, follow it (with cycle detection)
  if (
    cur &&
    typeof cur === "object" &&
    !Array.isArray(cur) &&
    "$ref" in cur &&
    typeof (cur as { $ref: unknown }).$ref === "string"
  ) {
    return resolveRef(spec, (cur as { $ref: string }).$ref, nextSeen)
  }

  return cur
}

/** Decodes JSON Pointer escapes: ~0 -> ~, ~1 -> / */
function decodeJsonPointerSegment(s: string): string {
  return s.replaceAll("~1", "/").replaceAll("~0", "~")
}
