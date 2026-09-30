import type { ProviderLifetime } from "@/lib/api"

/** `http-client` → `httpClient`: the name nodes read a provider by. */
export function providerName(fileBase: string): string {
  return fileBase.replace(/[-_]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase())
}

/** Starter source for `providers/<fileBase>.ts`. */
export function providerTemplate(fileBase: string, lifetime: ProviderLifetime): string {
  const head = `import { defineProvider } from "@darrylondil/lorien-runtime"
import { z } from "zod"
`
  // The doc comment is the description on the provider's card in the IDE.
  const doc = `/** What \`${providerName(fileBase)}\` holds, in a sentence. */`
  if (lifetime === "scoped") {
    return `${head}
${doc}
export default defineProvider({
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
