import type { Context, Next } from "hono"
import type { Providers, TailwindColor } from "../types.js"

export interface DefineMiddlewareInput {
  /** Display name in the IDE ("Require admin key"). No runtime effect. */
  name?: string
  /** IDE accent color. No runtime effect. */
  color?: TailwindColor
  /**
   * Runs before every route in this folder and below, as a Hono middleware:
   * return a Response to answer early, or `await next()` to continue. It gets
   * the same providers as nodes.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: matches Hono's own middleware return type.
  run(c: Context, next: Next, providers: Providers): Promise<Response | void> | Response | void
}

export interface Middleware extends DefineMiddlewareInput {
  readonly kind: "middleware"
}

/**
 * Declares middleware for the routes in a folder: put it in
 * `workflows/<folder>/_middleware.ts` and it runs before every workflow in
 * that folder and below, outermost folder first. Export an array to run
 * several in order.
 *
 * Middleware is for auth, CORS, rate limits and request logging. Business
 * logic, and turning errors into responses, belong in nodes.
 *
 * @example
 * // The key comes from a provider (providers/auth.ts declares ADMIN_KEY in its env).
 * export default defineMiddleware({
 *   name: "Require admin key",
 *   async run(c, next, { auth }) {
 *     if (c.req.header("x-admin-key") !== auth.adminKey) {
 *       return c.json({ error: "forbidden" }, 403)
 *     }
 *     await next()
 *   },
 * })
 */
export function defineMiddleware(def: DefineMiddlewareInput): Middleware {
  return { kind: "middleware", ...def }
}

export function isMiddleware(value: unknown): value is Middleware {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "middleware" &&
    typeof (value as { run?: unknown }).run === "function"
  )
}
