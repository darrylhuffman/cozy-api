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
  const read = `Nodes read it as \`${providerName(fileBase)}\`.`
  if (lifetime === "scoped") {
    return `${head}
/** Created once per request and disposed when it ends. ${read} */
export default defineProvider({
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
/** Created fresh every time a node reads it, so \`create\` must be synchronous. ${read} */
export default defineProvider({
  lifetime: "transient",
  create() {
    return {}
  },
})
`
  }
  return `${head}
/** Created once at startup and shared by every request. ${read} */
export default defineProvider({
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
