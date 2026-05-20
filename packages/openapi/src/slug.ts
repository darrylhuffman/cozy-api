/**
 * Converts an arbitrary string into a kebab-case slug safe for filenames
 * and module identifiers. "getPetById" -> "get-pet-by-id". "GET /pets/{id}" -> "get-pets-id".
 */
export function kebabCase(input: string): string {
  return input
    .replace(/\{([^}]*)\}/g, (_, inner: string) => inner.toLowerCase()) // lowercase brace content, strip braces
    .replace(/([a-z])([A-Z])/g, "$1-$2") // camelCase boundary -> hyphen
    .replace(/[^a-zA-Z0-9]+/g, "-") // non-alphanumeric -> hyphen
    .replace(/-+/g, "-") // collapse hyphens
    .replace(/^-|-$/g, "") // trim leading/trailing
    .toLowerCase()
}

/**
 * Pulls a slug for the API as a whole from the spec's info.title.
 */
export function apiSlugFromSpec(title: string): string {
  return kebabCase(title) || "api"
}

/**
 * Builds an operation filename: prefer operationId, fall back to method+path.
 */
export function operationFileName(opId: string | undefined, method: string, path: string): string {
  if (opId && opId.length > 0) return `${kebabCase(opId)}.ts`
  return `${kebabCase(`${method}-${path}`)}.ts`
}
