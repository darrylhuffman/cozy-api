const NPM_NAME = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

export interface NameValidation {
  ok: boolean
  reason?: string
}

/**
 * Validates a string as a valid npm package name + a usable directory name.
 * Rules:
 *  - npm package name format (lowercase, hyphens/dots/underscores allowed)
 *  - max 214 chars total
 *  - no leading dot or underscore
 *  - non-empty
 */
export function validateName(name: string): NameValidation {
  if (!name || name.length === 0) {
    return { ok: false, reason: "name is empty" }
  }
  if (name.length > 214) {
    return { ok: false, reason: "name must be 214 characters or fewer" }
  }
  if (name.startsWith(".") || name.startsWith("_")) {
    return { ok: false, reason: "name must not start with '.' or '_'" }
  }
  if (name !== name.toLowerCase()) {
    return { ok: false, reason: "name must be lowercase" }
  }
  if (!NPM_NAME.test(name)) {
    return {
      ok: false,
      reason:
        "name contains invalid characters (use lowercase letters, numbers, hyphens, dots, or underscores)",
    }
  }
  return { ok: true }
}
