import { spawn } from "node:child_process"
import { stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { NodeCaseFileResult } from "@darrylondil/lorien-runtime/testing"
import { resolveTsx } from "./introspect-workspace.js"

const RESULT_MARKER = "__LORIEN_NODE_CASES__"

export interface NodeCasesRun {
  files: NodeCaseFileResult[]
  /** What the nodes printed (console.log etc.), for the IDE to show. */
  logs: string
  /** Set when the worker could not run at all. */
  error?: string
}

export interface NodeCasesRequest {
  filter?: string
  only?: Record<string, string[]>
}

async function workerPath(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const c of [join(here, "node-cases-worker.js"), join(here, "node-cases-worker.ts")]) {
    try {
      if ((await stat(c)).isFile()) return c
    } catch {
      // try the next candidate
    }
  }
  return join(here, "node-cases-worker.js")
}

/** Parses the worker's stdout: logs, then the marker line with the results. */
export function parseWorkerOutput(stdout: string): {
  files: NodeCaseFileResult[] | null
  logs: string
} {
  const at = stdout.lastIndexOf(RESULT_MARKER)
  if (at === -1) return { files: null, logs: stdout.trim() }
  const json = stdout.slice(at + RESULT_MARKER.length).split(/\r?\n/)[0] ?? ""
  try {
    return { files: JSON.parse(json) as NodeCaseFileResult[], logs: stdout.slice(0, at).trim() }
  } catch {
    return { files: null, logs: stdout.trim() }
  }
}

/** Runs node cases in a fresh tsx subprocess rooted at the workspace. */
export async function runNodeCasesInWorker(
  root: string,
  req: NodeCasesRequest,
  opts: { timeoutMs?: number } = {},
): Promise<NodeCasesRun> {
  const tsx = await resolveTsx(root)
  if (!tsx) {
    return {
      files: [],
      logs: "",
      error:
        "tsx is not installed in this workspace, so node files can't be loaded (pnpm add -D tsx).",
    }
  }
  const worker = await workerPath()
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsx, worker, root, JSON.stringify(req)], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, opts.timeoutMs ?? 60_000)
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf-8")
    })
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf-8")
    })
    child.on("error", (e) => {
      clearTimeout(timer)
      resolve({ files: [], logs: "", error: `could not start the test worker: ${e.message}` })
    })
    child.on("exit", (code) => {
      clearTimeout(timer)
      const { files, logs } = parseWorkerOutput(stdout)
      const allLogs = [logs, stderr.trim()].filter(Boolean).join("\n")
      if (files) return resolve({ files, logs: allLogs })
      resolve({
        files: [],
        logs: allLogs,
        error: timedOut
          ? "node tests timed out (a node may be waiting forever)"
          : `the test worker exited with code ${code}${stderr.trim() ? `: ${stderr.trim().split("\n")[0]}` : ""}`,
      })
    })
  })
}
