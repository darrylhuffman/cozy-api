import type { z } from "zod"
import type { ServiceContext, Services, TailwindColor } from "../types.js"

/**
 * How long a provider's value lives, named after .NET's service lifetimes:
 * - `singleton`: created once at boot and shared by every request.
 * - `scoped`: created once per request, disposed when the request ends.
 * - `transient`: created every time a node or middleware reads it.
 */
export type ProviderLifetime = "singleton" | "scoped" | "transient"

/** A schema for the environment variables a provider reads. */
export type EnvSchema = z.ZodType<unknown>

export interface ProviderCreateContext<E, U extends string> {
  /** The parsed `env` schema, or `undefined` when the provider declares none. */
  env: E
  /** The providers named in `uses`, already created. */
  providers: { [K in U]: K extends keyof Services ? Services[K] : unknown }
  /** The current request. `null` for singletons, which are created at boot. */
  request: ServiceContext | null
}

/**
 * What a selector may be: a letter, then letters, digits, `_` or `-`, up to 64
 * characters (`db`, `PetStore`, `rate_limiter`, `http-client`).
 */
export const SELECTOR_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/** Keys every object already has, which a selector must not shadow. */
const RESERVED_SELECTORS = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  "then",
  "prototype",
])

/** Why `selector` can't name a provider, or null when it can. */
export function selectorProblem(selector: unknown): string | null {
  if (typeof selector !== "string" || selector === "") return "selector is required"
  if (!SELECTOR_PATTERN.test(selector)) {
    return `selector "${selector}" must start with a letter and use only letters, digits, _ or - (64 at most)`
  }
  if (RESERVED_SELECTORS.has(selector)) return `selector "${selector}" is reserved`
  return null
}

export interface DefineProviderInput<T, S extends EnvSchema | undefined, U extends string> {
  /**
   * The name nodes and middleware read this provider by: `selector: "db"` is
   * `run(input, { db })`. Letters, digits, `_` and `-`, starting with a letter;
   * prefer camelCase, since a dashed selector needs quotes (`providers["my-db"]`).
   */
  selector: string
  /** IDE accent color. No runtime effect. */
  color?: TailwindColor
  /** Defaults to `singleton`. */
  lifetime?: ProviderLifetime
  /** Environment variables this provider needs, validated once at boot. */
  env?: S
  /** Other providers this one is built from. A singleton may only use singletons. */
  uses?: readonly U[]
  create(
    context: ProviderCreateContext<S extends EnvSchema ? z.output<S> : undefined, U>,
  ): T | Promise<T>
  dispose?(value: Awaited<T>): void | Promise<void>
}

export interface Provider<
  T = unknown,
  S extends EnvSchema | undefined = EnvSchema | undefined,
  U extends string = string,
> {
  readonly kind: "provider"
  readonly selector: string
  readonly color?: TailwindColor
  readonly lifetime: ProviderLifetime
  readonly env?: S
  readonly uses: readonly U[]
  create(
    context: ProviderCreateContext<S extends EnvSchema ? z.output<S> : undefined, U>,
  ): T | Promise<T>
  dispose?(value: Awaited<T>): void | Promise<void>
}

// biome-ignore lint/suspicious/noExplicitAny: the widest provider, for registries.
export type AnyProvider = Provider<any, any, any>

/** The value a provider injects into nodes: what its `create` resolves to. */
export type ProvidedValue<P> = P extends { create(...args: never[]): infer T } ? Awaited<T> : never

/**
 * Declares a provider: a dependency injected into every node and middleware,
 * like a registration in an ASP.NET `Program.cs`. Put one per file anywhere
 * under `providers/`; its `selector` is the name nodes read it by.
 *
 * Providers hold connections and clients, never business logic: that belongs
 * in nodes.
 *
 * @example
 * export default defineProvider({
 *   selector: "db",
 *   env: z.object({ DATABASE_URL: z.string() }),
 *   create: ({ env }) => new Pool({ connectionString: env.DATABASE_URL }),
 *   dispose: (pool) => pool.end(),
 * })
 */
export function defineProvider<
  T,
  S extends EnvSchema | undefined = undefined,
  U extends string = never,
>(def: DefineProviderInput<T, S, U>): Provider<T, S, U> {
  const problem = selectorProblem(def.selector)
  if (problem) throw new Error(`defineProvider: ${problem}`)
  return {
    kind: "provider",
    selector: def.selector,
    color: def.color,
    lifetime: def.lifetime ?? "singleton",
    env: def.env,
    uses: def.uses ?? [],
    create: def.create,
    dispose: def.dispose,
  } as Provider<T, S, U>
}

export function isProvider(value: unknown): value is AnyProvider {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "provider" &&
    typeof (value as { create?: unknown }).create === "function"
  )
}
