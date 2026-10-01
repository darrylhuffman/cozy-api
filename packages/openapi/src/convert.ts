import { emitClientProvider, selectorFromSlug } from "./emit-client.js"
import { emitOperationNode } from "./emit-operation.js"
import type { OpenAPIObject } from "./load-spec.js"
import { apiSlugFromSpec, operationFileName } from "./slug.js"

export interface ConvertOptions {
  /** Override the api slug derived from spec.info.title. */
  apiSlug?: string
  /** Default base URL for the client provider (else the spec's first absolute server URL). */
  defaultBaseUrl?: string
}

export interface GeneratedFile {
  /** Path relative to where it's written: nodes/<apiSlug>/, or providers/ for the client. */
  relativePath: string
  /** Full TS source contents. */
  source: string
  /** Written on first import only; re-imports keep it unless --force. */
  keepOnReimport?: boolean
}

export interface ConvertResult {
  apiSlug: string
  /** The client provider's selector, which every operation node reads. */
  selector: string
  /** One node per operation, relative to nodes/<apiSlug>/. */
  files: GeneratedFile[]
  /** The client provider, relative to providers/. */
  provider: GeneratedFile
  warnings: string[]
}

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const

export function convertOpenApiSpec(spec: OpenAPIObject, opts: ConvertOptions = {}): ConvertResult {
  const apiSlug = opts.apiSlug ?? apiSlugFromSpec(spec.info?.title ?? "")
  const selector = selectorFromSlug(apiSlug)
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
        selector,
      )
      const opId = (op as { operationId?: string }).operationId
      const fileName = operationFileName(opId, method, pathTemplate)
      files.push({ relativePath: fileName, source })
      warnings.push(...opWarnings)
    }
  }

  const defaultBaseUrl = opts.defaultBaseUrl ?? serverUrl(spec)
  const provider: GeneratedFile = {
    relativePath: `${selector}.ts`,
    source: emitClientProvider(apiSlug, {
      selector,
      ...(spec.info?.title ? { title: spec.info.title } : {}),
      ...(defaultBaseUrl ? { defaultBaseUrl } : {}),
    }),
    keepOnReimport: true,
  }

  return { apiSlug, selector, files, provider, warnings }
}

/** The spec's first absolute server URL without template variables, if any. */
function serverUrl(spec: OpenAPIObject): string | undefined {
  const servers = (spec as { servers?: Array<{ url?: string }> }).servers ?? []
  return servers.map((s) => s.url).find((u) => !!u && /^https?:\/\//.test(u) && !u.includes("{"))
}
