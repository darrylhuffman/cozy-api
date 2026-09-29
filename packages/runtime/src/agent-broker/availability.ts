import { spawn } from "node:child_process"
import type {
  AgentAvailability,
  AgentName,
  AvailabilityResponse,
} from "./types.js"

export interface ProbeExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type ProbeExec = (
  command: string,
  args: string[],
) => Promise<ProbeExecResult>

interface CacheEntry {
  expiresAt: number
  result: AvailabilityResponse
}

const CACHE_TTL_MS = 30_000

/**
 * Default exec: spawns the binary with `--version` and waits for exit with a
 * short hard timeout. Promise resolves with the result on any exit (success
 * or failure) and rejects only on spawn errors (e.g. ENOENT).
 */
const defaultExec: ProbeExec = (command, args) =>
  new Promise<ProbeExecResult>((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      // `shell: true` on Windows is required to resolve `.cmd`/`.bat`/`.ps1` shims
      // used by npm-installed global CLIs. Args contain only the literal "--version"
      // string, so there is no shell-injection surface.
      shell: process.platform === "win32",
    })
    const timer = setTimeout(() => {
      proc.kill("SIGKILL")
    }, 3000)
    proc.stdout.on("data", (d) => {
      stdout += String(d)
    })
    proc.stderr.on("data", (d) => {
      stderr += String(d)
    })
    proc.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc.on("close", (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })
  })

const VERSION_RE = /(\d+\.\d+\.\d+)/

function parseVersion(stdout: string): string | undefined {
  const m = VERSION_RE.exec(stdout)
  return m ? m[1] : undefined
}

const BINARIES: Record<AgentName, string> = {
  claude: "claude",
  codex: "codex",
}

export interface AvailabilityProbeOptions {
  exec?: ProbeExec
  now?: () => number
}

export class AvailabilityProbe {
  private readonly exec: ProbeExec
  private readonly now: () => number
  private cache: CacheEntry | null = null
  private inflight: Promise<AvailabilityResponse> | null = null

  constructor(opts: AvailabilityProbeOptions = {}) {
    this.exec = opts.exec ?? defaultExec
    this.now = opts.now ?? Date.now
  }

  async probe(): Promise<AvailabilityResponse> {
    const t = this.now()
    if (this.cache && this.cache.expiresAt > t) {
      return this.cache.result
    }
    if (this.inflight) return this.inflight
    this.inflight = this.runProbe(t).finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async runProbe(t: number): Promise<AvailabilityResponse> {
    const [claude, codex] = await Promise.all([
      this.probeOne(BINARIES.claude),
      this.probeOne(BINARIES.codex),
    ])
    const result: AvailabilityResponse = { claude, codex }
    this.cache = { result, expiresAt: t + CACHE_TTL_MS }
    return result
  }

  private async probeOne(binary: string): Promise<AgentAvailability> {
    try {
      const r = await this.exec(binary, ["--version"])
      if (r.exitCode !== 0) return { installed: false }
      const version = parseVersion(r.stdout || r.stderr)
      return version === undefined
        ? { installed: true }
        : { installed: true, version }
    } catch {
      return { installed: false }
    }
  }
}
