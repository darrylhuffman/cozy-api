import { defineMiddleware } from "@darrylondil/lorien-runtime"

/**
 * Runs before every route: logs each request with the request's logger and
 * reports how long it took in an `x-response-time` header.
 */
export default defineMiddleware({
  name: "Request log",
  async run(c, next, { logger }) {
    const started = performance.now()
    await next()
    const ms = Math.round(performance.now() - started)
    c.res.headers.set("x-response-time", `${ms}ms`)
    logger.info(`${c.req.method} ${c.req.path}`, { status: c.res.status, ms })
  },
})
