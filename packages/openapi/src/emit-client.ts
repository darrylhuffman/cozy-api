/**
 * Emits the API's client provider, `providers/<selector>.ts`: the base URL
 * (from an env var, defaulting to the spec's first absolute server URL) and
 * the headers every request sends. The operation nodes read it by selector.
 * Generated on first import only, and preserved on re-import (so auth added
 * to `headers` survives) unless --force is passed.
 */
export function emitClientProvider(
  apiSlug: string,
  opts: { selector: string; title?: string; defaultBaseUrl?: string },
): string {
  const envVar = `${apiSlug.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_BASE_URL`
  const base = `z.string().url()${opts.defaultBaseUrl ? `.default(${JSON.stringify(opts.defaultBaseUrl)})` : ""}`
  const name = opts.title?.trim() || apiSlug
  return [
    `// lorien-openapi: generated client provider. Edit headers() to add auth; re-imports keep your changes unless --force.`,
    `import { defineProvider } from "@darrylondil/lorien-runtime"`,
    `import { z } from "zod"`,
    ``,
    `/** The ${name} API: its base URL (${envVar}) and the headers every request sends. */`,
    `export default defineProvider({`,
    `  selector: ${JSON.stringify(opts.selector)},`,
    `  env: z.object({ ${envVar}: ${base} }),`,
    `  create: ({ env }) => ({`,
    `    baseUrl: env.${envVar}.replace(/\\/+$/, ""),`,
    `    headers(extra?: Record<string, string>): Record<string, string> {`,
    `      return { "content-type": "application/json", ...(extra ?? {}) }`,
    `    },`,
    `  }),`,
    `})`,
    ``,
  ].join("\n")
}

/** The provider selector for an API slug: `acme-payments` → `acmePayments`. */
export function selectorFromSlug(apiSlug: string): string {
  const camel = apiSlug.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
  return /^[a-zA-Z]/.test(camel) ? camel : `api${camel}`
}

// Re-export for convenience
export { kebabCase } from "./slug.js"
