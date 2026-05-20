export type PackageManager = "npm" | "pnpm" | "yarn" | "bun"

/**
 * Detects the package manager that invoked this CLI by reading process.env.npm_config_user_agent.
 *
 * npm sets a user agent like: "npm/10.2.0 node/v20.10.0 linux x64 ..."
 * pnpm sets: "pnpm/8.15.0 ..."
 * yarn sets: "yarn/4.0.2 ..."
 * bun sets: "bun/1.0.20 ..."
 *
 * Defaults to "npm" if the user agent is missing or unrecognized.
 */
export function detectPackageManager(
  userAgent: string | undefined = process.env.npm_config_user_agent,
): PackageManager {
  if (!userAgent) return "npm"
  const first = userAgent.split(" ")[0] ?? ""
  if (first.startsWith("pnpm/")) return "pnpm"
  if (first.startsWith("yarn/")) return "yarn"
  if (first.startsWith("bun/")) return "bun"
  if (first.startsWith("npm/")) return "npm"
  return "npm"
}
