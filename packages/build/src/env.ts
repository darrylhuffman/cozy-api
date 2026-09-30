import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

/**
 * Loads the project's `.env` into `process.env`, the way `node --env-file`
 * would: variables already set in the shell win. Every command runs this
 * first, so `lorien test`, the IDE and `lorien types` see the same provider
 * env as `lorien dev`. Returns whether a file was loaded.
 */
export function loadProjectEnv(root: string): boolean {
  const file = join(resolve(root), ".env")
  if (!existsSync(file) || typeof process.loadEnvFile !== "function") return false
  process.loadEnvFile(file)
  return true
}
