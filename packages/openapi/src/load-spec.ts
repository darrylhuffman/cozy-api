import { readFile } from "node:fs/promises"
import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types"

export type OpenAPIObject = OpenAPIV3.Document | OpenAPIV3_1.Document

export class OpenAPIError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OpenAPIError"
  }
}

export async function loadOpenApiSpec(path: string): Promise<OpenAPIObject> {
  let text: string
  try {
    text = await readFile(path, "utf-8")
  } catch (e) {
    throw new OpenAPIError(`Failed to read spec at ${path}: ${(e as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new OpenAPIError(`Invalid JSON in ${path}: ${(e as Error).message}`)
  }

  return validateOpenApi(parsed, path)
}

export function validateOpenApi(spec: unknown, source = "<inline>"): OpenAPIObject {
  if (!spec || typeof spec !== "object") {
    throw new OpenAPIError(`${source}: spec must be a JSON object`)
  }
  const s = spec as Record<string, unknown>

  const version = s.openapi
  if (typeof version !== "string") {
    throw new OpenAPIError(`${source}: missing required \`openapi\` version field`)
  }
  if (!version.startsWith("3.")) {
    throw new OpenAPIError(`${source}: only OpenAPI 3.x is supported (got "${version}")`)
  }

  if (!s.paths || typeof s.paths !== "object" || Array.isArray(s.paths)) {
    throw new OpenAPIError(`${source}: missing or invalid \`paths\` object`)
  }

  return s as unknown as OpenAPIObject
}
