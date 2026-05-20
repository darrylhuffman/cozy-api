import { spawn } from "node:child_process"
import type { PackageManager } from "./detect-package-manager.js"

export interface InstallResult {
  ok: boolean
  /** Exit code, or null if the process couldn't be spawned. */
  exitCode: number | null
  /** A user-friendly error message when ok is false. */
  error?: string
}

/**
 * Returns the command + args this package manager uses to install dependencies.
 * Exported so cli.ts can print the manual command if install fails.
 */
export function installCommand(pm: PackageManager): { cmd: string; args: string[] } {
  switch (pm) {
    case "pnpm":
      return { cmd: "pnpm", args: ["install"] }
    case "yarn":
      return { cmd: "yarn", args: ["install"] }
    case "bun":
      return { cmd: "bun", args: ["install"] }
    case "npm":
      return { cmd: "npm", args: ["install"] }
  }
}

export async function runInstall(opts: {
  target: string
  pm: PackageManager
}): Promise<InstallResult> {
  const { cmd, args } = installCommand(opts.pm)
  return new Promise<InstallResult>((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.target,
      stdio: "inherit",
      shell: process.platform === "win32", // Windows needs shell:true for .cmd shims
    })
    child.on("error", (err) => {
      resolve({ ok: false, exitCode: null, error: err.message })
    })
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, exitCode: 0 })
      } else {
        resolve({
          ok: false,
          exitCode: code,
          error: `${cmd} ${args.join(" ")} exited with code ${code ?? "null"}`,
        })
      }
    })
  })
}
