/**
 * Emits the _client.ts helper for an API. This file is generated on first import only;
 * preserved on re-import (so user customizations of baseUrl/headers survive).
 */
export function emitClientHelper(apiSlug: string, defaultBaseUrl?: string): string {
  const envVar = `${apiSlug.toUpperCase().replace(/-/g, "_")}_BASE_URL`
  const fallback = defaultBaseUrl ?? "https://api.example.com"
  return [
    `// cozy-openapi: generated _client helper. Edit baseUrl()/buildHeaders() to customize.`,
    `// This file is preserved across re-imports unless --force is passed.`,
    ``,
    `export function baseUrl(): string {`,
    `  return process.env.${envVar} ?? ${JSON.stringify(fallback)}`,
    `}`,
    ``,
    `export function buildHeaders(extra?: Record<string, string>): Record<string, string> {`,
    `  return {`,
    `    "content-type": "application/json",`,
    `    ...(extra ?? {}),`,
    `  }`,
    `}`,
    ``,
  ].join("\n")
}

// Re-export for convenience
export { kebabCase } from "./slug.js"
