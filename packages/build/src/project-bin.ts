import { delimiter, join } from "node:path"

/**
 * `env` with the project's node_modules/.bin first on the path, so its own
 * tsx is found even when lorien runs outside a package script. Keeps the
 * variable's existing name (`Path` on Windows).
 */
export function withProjectBin(root: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH"
  const bin = join(root, "node_modules", ".bin")
  return { ...env, [key]: env[key] ? `${bin}${delimiter}${env[key]}` : bin }
}
