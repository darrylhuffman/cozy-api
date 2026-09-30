import type { ProviderLifetime } from "@/lib/api"

/** What a selector may be; mirrors the runtime's `SELECTOR_PATTERN`. */
export const SELECTOR_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/** How a node reads a provider: `{ db }`, or quoted when the selector has a dash. */
export function selectorRead(selector: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(selector) ? `{ ${selector} }` : `providers["${selector}"]`
}

/** Starter source for a provider read as `selector`. */
export function providerTemplate(selector: string, lifetime: ProviderLifetime): string {
  const head = `import { defineProvider } from "@darrylondil/lorien-runtime"
import { z } from "zod"
`
  // The doc comment is the description on the provider's card in the IDE.
  const doc = `/** What ${selector} holds, in a sentence. */`
  const sel = `  selector: ${JSON.stringify(selector)},`
  if (lifetime === "scoped") {
    return `${head}
${doc}
export default defineProvider({
${sel}
  // Created once per request and disposed when it ends.
  lifetime: "scoped",
  create({ request }) {
    return { requestId: request?.requestId }
  },
  // dispose(value) {},
})
`
  }
  if (lifetime === "transient") {
    return `${head}
${doc}
export default defineProvider({
${sel}
  // Created fresh every time a node reads it, so \`create\` must be synchronous.
  lifetime: "transient",
  create() {
    return {}
  },
})
`
  }
  return `${head}
${doc}
export default defineProvider({
${sel}
  // Created once at startup and shared by every request.
  // Environment variables, validated at startup.
  env: z.object({}),
  create({ env }) {
    return {}
  },
  // Close connections when the app shuts down.
  // dispose(value) {},
})
`
}
