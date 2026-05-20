import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types"
import type { OpenAPIObject } from "./load-spec.js"
import { resolveRef } from "./resolve-ref.js"
import type { ConvertContext } from "./schema-to-zod.js"
import { newContext, schemaToZod } from "./schema-to-zod.js"

type OperationObject = OpenAPIV3.OperationObject | OpenAPIV3_1.OperationObject
type ParameterObject = OpenAPIV3.ParameterObject | OpenAPIV3_1.ParameterObject

export interface EmitResult {
  /** The TypeScript source for this operation's node. */
  source: string
  /** Warnings collected during conversion. */
  warnings: string[]
}

const HEADER_MARKER = "// cozy-openapi: generated"

export function emitOperationNode(
  spec: OpenAPIObject,
  op: OperationObject,
  path: string,
  method: string,
): EmitResult {
  const ctx = newContext()

  const friendlyName = op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`
  const opId = op.operationId ?? `${method}_${path}`

  // Parameters: separate by `in` location
  const params = (op.parameters ?? []) as Array<ParameterObject | OpenAPIV3.ReferenceObject>
  const resolved = params.map((p) =>
    "$ref" in p ? (resolveRef(spec, p.$ref) as ParameterObject) : p,
  )
  const pathParams = resolved.filter((p) => p.in === "path")
  const queryParams = resolved.filter((p) => p.in === "query")
  const headerParams = resolved.filter((p) => p.in === "header")

  const pathParamsZod = paramsToZodObject(pathParams, spec, ctx)
  const queryParamsZod = paramsToZodObject(queryParams, spec, ctx)
  const headerParamsZod = paramsToZodObject(headerParams, spec, ctx)

  // Request body
  const requestBody =
    op.requestBody && !("$ref" in op.requestBody)
      ? (op.requestBody as OpenAPIV3.RequestBodyObject)
      : null
  const requestBodyZod = requestBody?.content?.["application/json"]?.schema
    ? schemaToZod(requestBody.content["application/json"].schema as never, spec, ctx)
    : null

  // Response: first 2xx with application/json
  const responses = op.responses ?? {}
  const twoXX = Object.entries(responses).find(([code]) => code.startsWith("2"))
  let responseBodyZod = "z.unknown()"
  if (twoXX) {
    const [, respRaw] = twoXX
    const resp =
      "$ref" in respRaw
        ? (resolveRef(spec, respRaw.$ref) as OpenAPIV3.ResponseObject)
        : (respRaw as OpenAPIV3.ResponseObject)
    const jsonContent = resp.content?.["application/json"]?.schema
    if (jsonContent) {
      responseBodyZod = schemaToZod(jsonContent as never, spec, ctx)
    }
  }

  // Build inputs schema
  const inputsFields: string[] = []
  if (pathParamsZod !== null) inputsFields.push(`  pathParams: ${pathParamsZod}`)
  if (queryParamsZod !== null) inputsFields.push(`  query: ${queryParamsZod}`)
  if (headerParamsZod !== null) inputsFields.push(`  headers: ${headerParamsZod}`)
  if (requestBodyZod !== null) inputsFields.push(`  body: ${requestBodyZod}`)

  const inputsSchemaStr =
    inputsFields.length > 0 ? `z.object({\n${inputsFields.join(",\n")},\n  })` : `z.object({})`

  // Build URL template — replace OpenAPI {x} with template literal slots
  const pathTemplate = path.replace(/\{([^}]+)\}/g, (_, name: string) => `\${pathParams.${name}}`)

  // Build the run body
  const runBody = buildRunBody({
    method: method.toUpperCase(),
    pathTemplate,
    hasPathParams: pathParamsZod !== null,
    hasQuery: queryParamsZod !== null,
    hasHeaders: headerParamsZod !== null,
    hasBody: requestBodyZod !== null,
  })

  const source = [
    `${HEADER_MARKER} from operation \`${opId}\`.`,
    `// Do NOT edit manually — re-run \`cozy import-openapi <spec>\` to regenerate.`,
    `import { defineNode } from "@cozy/runtime"`,
    `import { z } from "zod"`,
    `import { baseUrl, buildHeaders } from "./_client.js"`,
    ``,
    `export default defineNode({`,
    `  name: ${JSON.stringify(friendlyName)},`,
    `  inputs: ${inputsSchemaStr},`,
    `  outputs: z.object({ data: ${responseBodyZod} }),`,
    `  async run(input) {`,
    runBody,
    `  },`,
    `})`,
    ``,
  ].join("\n")

  return { source, warnings: ctx.warnings }
}

function paramsToZodObject(
  params: Array<OpenAPIV3.ParameterObject | OpenAPIV3_1.ParameterObject>,
  spec: OpenAPIObject,
  ctx: ConvertContext,
): string | null {
  if (params.length === 0) return null
  const entries: string[] = []
  for (const p of params) {
    if (!p.schema) {
      entries.push(`    ${JSON.stringify(p.name)}: z.unknown()`)
      continue
    }
    let valueExpr = schemaToZod(p.schema as never, spec, ctx)
    if (!p.required) valueExpr += `.optional()`
    entries.push(`    ${JSON.stringify(p.name)}: ${valueExpr}`)
  }
  return `z.object({\n${entries.join(",\n")},\n  })`
}

interface RunBodyOpts {
  method: string
  pathTemplate: string
  hasPathParams: boolean
  hasQuery: boolean
  hasHeaders: boolean
  hasBody: boolean
}

function buildRunBody(opts: RunBodyOpts): string {
  const lines: string[] = []
  const pathParamsAccess = opts.hasPathParams ? `const pathParams = input.pathParams` : ""
  if (opts.hasPathParams) lines.push(`    ${pathParamsAccess}`)
  lines.push(`    const url = new URL(\`${opts.pathTemplate}\`, baseUrl())`)
  if (opts.hasQuery) {
    lines.push(`    for (const [k, v] of Object.entries(input.query ?? {})) {`)
    lines.push(`      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))`)
    lines.push(`    }`)
  }
  const fetchOpts: string[] = []
  fetchOpts.push(`method: "${opts.method}"`)
  fetchOpts.push(
    `headers: buildHeaders(${opts.hasHeaders ? "input.headers as Record<string, string> | undefined" : ""})`,
  )
  if (opts.hasBody) fetchOpts.push(`body: JSON.stringify(input.body)`)
  lines.push(`    const res = await fetch(url, {`)
  lines.push(`      ${fetchOpts.join(",\n      ")},`)
  lines.push(`    })`)
  lines.push(`    if (!res.ok) {`)
  lines.push(`      throw new Error(\`Request failed: \${res.status} \${res.statusText}\`)`)
  lines.push(`    }`)
  lines.push(`    return { data: await res.json() }`)
  return lines.join("\n")
}

export const OPENAPI_GENERATED_MARKER = HEADER_MARKER
