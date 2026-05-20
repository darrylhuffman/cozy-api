import { emitClientHelper } from "./emit-client.js"
import { emitOperationNode } from "./emit-operation.js"
import type { OpenAPIObject } from "./load-spec.js"
import { apiSlugFromSpec, operationFileName } from "./slug.js"

export interface ConvertOptions {
  /** Override the api slug derived from spec.info.title. */
  apiSlug?: string
  /** Default base URL for the _client.ts file. */
  defaultBaseUrl?: string
}

export interface GeneratedFile {
  /** Path relative to nodes/<apiSlug>/ — e.g. "get-pet-by-id.ts" or "_client.ts". */
  relativePath: string
  /** Full TS source contents. */
  source: string
}

export interface ConvertResult {
  apiSlug: string
  files: GeneratedFile[]
  warnings: string[]
}

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const

export function convertOpenApiSpec(spec: OpenAPIObject, opts: ConvertOptions = {}): ConvertResult {
  const apiSlug = opts.apiSlug ?? apiSlugFromSpec(spec.info?.title ?? "")
  const files: GeneratedFile[] = []
  const warnings: string[] = []

  // Walk all paths/operations
  for (const [pathTemplate, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue
    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<string, unknown>)[method]
      if (!op || typeof op !== "object") continue
      const { source, warnings: opWarnings } = emitOperationNode(
        spec,
        op as never,
        pathTemplate,
        method,
      )
      const opId = (op as { operationId?: string }).operationId
      const fileName = operationFileName(opId, method, pathTemplate)
      files.push({ relativePath: fileName, source })
      warnings.push(...opWarnings)
    }
  }

  // Add _client.ts
  files.push({
    relativePath: "_client.ts",
    source: emitClientHelper(apiSlug, opts.defaultBaseUrl),
  })

  return { apiSlug, files, warnings }
}
