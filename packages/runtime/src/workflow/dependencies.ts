import { parseReference } from "./reference.js"
import type { NodeInstance, ParsedReference } from "./types.js"

/** A parsed `when`: the reference it reads, and whether a leading `!` negates it. */
export interface ParsedWhen {
  ref: ParsedReference
  negate: boolean
}

/** Parses a `when` condition ("Room.found" or "!Room.found"); null when it isn't one. */
export function parseWhen(raw: string): ParsedWhen | null {
  const negate = raw.startsWith("!")
  const ref = parseReference(negate ? raw.slice(1) : raw)
  return ref ? { ref, negate } : null
}

/**
 * The nodes whose outputs this node reads: its `in` references and its
 * `when`. If any of them was skipped, this node is skipped too. (`after` only
 * orders nodes, so it isn't one of these.)
 */
export function dataDependencies(inst: NodeInstance): string[] {
  const deps = new Set<string>()
  if (typeof inst.in === "string") {
    const ref = parseReference(inst.in)
    if (ref) deps.add(ref.nodeId)
  } else if (inst.in) {
    for (const raw of Object.values(inst.in)) {
      const ref = typeof raw === "string" ? parseReference(raw) : null
      if (ref) deps.add(ref.nodeId)
    }
  }
  if (inst.when !== undefined) {
    const when = parseWhen(inst.when)
    if (when) deps.add(when.ref.nodeId)
  }
  return [...deps]
}

/** Every node this node waits for: its data dependencies plus `after`. */
export function nodeDependencies(inst: NodeInstance): string[] {
  return [...new Set([...dataDependencies(inst), ...(inst.after ?? [])])]
}
