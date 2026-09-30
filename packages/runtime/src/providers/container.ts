import type { ServiceContext, ServiceValue } from "../types.js"
import type { AnyProvider } from "./define-provider.js"
import { planProviders } from "./plan.js"

export interface ProviderScope {
  /** What nodes receive as their second argument. Transient providers are getters. */
  values: Record<string, unknown>
  /** Disposes this request's scoped and transient values. */
  dispose(): Promise<void>
}

export interface ProviderContainer {
  readonly names: string[]
  /** Creates the singletons. Called once; later calls reuse the first result. */
  init(): Promise<void>
  /** Opens a request scope. Calls `init` first if needed. */
  open(request: ServiceContext): Promise<ProviderScope>
  /** Disposes the singletons. */
  dispose(): Promise<void>
}

export interface CreateProviderContainerOptions {
  /** Defaults to `process.env`. */
  env?: Record<string, string | undefined>
  /**
   * Services from `lorien.config.ts`. Plain values act as singletons and
   * factories run once per request, as they always have.
   */
  legacy?: Record<string, ServiceValue<unknown>>
  /** Values that replace providers of the same name (tests, IDE mocks). */
  overrides?: Record<string, unknown>
}

/**
 * Validates every provider's `env` once. Throws one error naming each
 * provider and variable that is missing or invalid.
 */
export function readProviderEnvs(
  providers: Record<string, AnyProvider>,
  env: Record<string, string | undefined>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const problems: string[] = []
  for (const [name, p] of Object.entries(providers)) {
    if (!p.env) continue
    const parsed = p.env.safeParse(env)
    if (parsed.success) {
      out[name] = parsed.data
      continue
    }
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "(env)"
      problems.push(`  ${name}: ${key}: ${issue.message}`)
    }
  }
  if (problems.length > 0) {
    throw new Error(`[lorien] provider environment is invalid:\n${problems.join("\n")}`)
  }
  return out
}

/**
 * The dev-time counterpart of the wiring `lorien build` emits: creates
 * singletons once, scoped providers per request, and transient providers on
 * every read.
 */
export function createProviderContainer(
  providers: Record<string, AnyProvider>,
  opts: CreateProviderContainerOptions = {},
): ProviderContainer {
  const legacy = opts.legacy ?? {}
  const overrides = opts.overrides ?? {}
  const active: Record<string, AnyProvider> = {}
  for (const [name, p] of Object.entries(providers)) {
    if (!(name in overrides)) active[name] = p
  }

  const plan = planProviders(
    Object.entries(active).map(([name, p]) => ({ name, lifetime: p.lifetime, uses: p.uses })),
    [...Object.keys(legacy), ...Object.keys(overrides)],
  )
  if (plan.errors.length > 0) {
    throw new Error(`[lorien] ${plan.errors.join("\n[lorien] ")}`)
  }

  let singletons: Record<string, unknown> | null = null
  let envs: Record<string, unknown> = {}
  let initializing: Promise<void> | null = null

  const pick = (source: Record<string, unknown>, names: readonly string[]) => {
    const out: Record<string, unknown> = {}
    for (const n of names) out[n] = source[n]
    return out
  }

  const init = (): Promise<void> => {
    initializing ??= (async () => {
      envs = readProviderEnvs(active, opts.env ?? process.env)
      const values: Record<string, unknown> = { ...overrides }
      for (const [name, value] of Object.entries(legacy)) {
        if (typeof value !== "function" && !(name in overrides)) values[name] = value
      }
      for (const name of plan.order) {
        const p = active[name]!
        if (p.lifetime !== "singleton") continue
        values[name] = await p.create({
          env: envs[name],
          providers: pick(values, p.uses),
          request: null,
        })
      }
      singletons = values
    })()
    return initializing
  }

  return {
    names: [...new Set([...Object.keys(providers), ...Object.keys(legacy)])],
    init,

    async open(request) {
      await init()
      const values: Record<string, unknown> = { ...singletons }
      const created: Array<[AnyProvider, unknown]> = []

      for (const [name, value] of Object.entries(legacy)) {
        if (typeof value === "function" && !(name in overrides)) {
          values[name] = await (value as (c: ServiceContext) => unknown)(request)
        }
      }
      for (const name of plan.order) {
        const p = active[name]!
        if (p.lifetime === "scoped") {
          const value = await p.create({
            env: envs[name],
            providers: pick(values, p.uses),
            request,
          })
          values[name] = value
          created.push([p, value])
        } else if (p.lifetime === "transient") {
          Object.defineProperty(values, name, {
            enumerable: true,
            get() {
              const value = p.create({ env: envs[name], providers: pick(values, p.uses), request })
              if (value && typeof (value as PromiseLike<unknown>).then === "function") {
                throw new Error(
                  `[lorien] transient provider "${name}" must create its value synchronously`,
                )
              }
              created.push([p, value])
              return value
            },
          })
        }
      }

      return {
        values,
        async dispose() {
          await disposeAll(created.reverse())
        },
      }
    },

    async dispose() {
      if (!initializing) return
      await initializing
      const created: Array<[AnyProvider, unknown]> = []
      for (const name of plan.order) {
        const p = active[name]!
        if (p.lifetime === "singleton") created.push([p, singletons?.[name]])
      }
      await disposeAll(created.reverse())
    },
  }
}

async function disposeAll(created: Array<[AnyProvider, unknown]>): Promise<void> {
  for (const [p, value] of created) {
    if (!p.dispose) continue
    try {
      await p.dispose(value)
    } catch (e) {
      console.error(`[lorien] disposing a provider failed: ${(e as Error).message}`)
    }
  }
}
