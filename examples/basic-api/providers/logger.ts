import { defineProvider } from "@darrylondil/lorien-runtime"

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void
}

/** A logger per request, so every line carries the request id. */
export default defineProvider({
  lifetime: "scoped",
  create: ({ request }): Logger => ({
    info: (msg, fields) => console.log("[info]", msg, { requestId: request?.requestId, ...fields }),
  }),
})
