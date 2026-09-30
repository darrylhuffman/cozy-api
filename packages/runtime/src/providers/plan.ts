import type { ProviderLifetime } from "./define-provider.js"

export interface ProviderPlanEntry {
  name: string
  lifetime: ProviderLifetime
  uses: readonly string[]
}

export interface ProviderPlan {
  /** Provider names in creation order: every provider comes after the ones it uses. */
  order: string[]
  errors: string[]
}

/**
 * Checks how providers depend on each other and orders them for creation.
 *
 * `external` names (legacy `lorien.config.ts` services) may be used by any
 * provider. A singleton may only use other singletons, the rule ASP.NET
 * enforces: a singleton holding a scoped value would leak one request's value
 * into every other request.
 */
export function planProviders(
  entries: ProviderPlanEntry[],
  external: readonly string[] = [],
): ProviderPlan {
  const errors: string[] = []
  const byName = new Map(entries.map((e) => [e.name, e]))
  const externalSet = new Set(external)

  for (const e of entries) {
    if (externalSet.has(e.name)) {
      errors.push(`provider "${e.name}" is also a service in lorien.config.ts; remove one of them`)
    }
    for (const dep of e.uses) {
      const target = byName.get(dep)
      if (!target) {
        if (!externalSet.has(dep))
          errors.push(`provider "${e.name}" uses unknown provider "${dep}"`)
        continue
      }
      if (e.lifetime === "singleton" && target.lifetime !== "singleton") {
        errors.push(
          `singleton provider "${e.name}" can't use ${target.lifetime} provider "${dep}": ` +
            `it would keep one request's value forever. Make "${e.name}" ${target.lifetime}, ` +
            `or "${dep}" a singleton.`,
        )
      }
    }
  }

  const order: string[] = []
  const state = new Map<string, "visiting" | "done">()
  const visit = (name: string, path: string[]): void => {
    const s = state.get(name)
    if (s === "done") return
    if (s === "visiting") {
      errors.push(`providers use each other in a cycle: ${[...path, name].join(" -> ")}`)
      return
    }
    state.set(name, "visiting")
    for (const dep of byName.get(name)?.uses ?? []) {
      if (byName.has(dep)) visit(dep, [...path, name])
    }
    state.set(name, "done")
    order.push(name)
  }
  for (const name of [...byName.keys()].sort()) visit(name, [])

  return { order, errors }
}
