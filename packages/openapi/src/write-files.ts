import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { GeneratedFile } from "./convert.js"
import { OPENAPI_GENERATED_MARKER } from "./emit-operation.js"

export interface WriteOptions {
  /** Overwrite all files regardless of marker. */
  force?: boolean
  /** Suppress per-file log lines. */
  quiet?: boolean
}

export interface WriteResult {
  written: string[]
  preserved: string[]
  errors: Array<{ path: string; message: string }>
}

/**
 * Writes generated files to disk under outRoot. Respects the lorien-openapi marker:
 *   - File doesn't exist → write
 *   - File exists with marker → overwrite
 *   - File exists without marker → preserve (don't touch user-authored files)
 *   - --force → always overwrite
 *
 * The _client.ts file is treated specially: it's generated on first import only,
 * preserved on re-import unless --force is passed (matches design spec).
 */
export async function writeGeneratedFiles(
  files: GeneratedFile[],
  outRoot: string,
  opts: WriteOptions = {},
): Promise<WriteResult> {
  const root = resolve(outRoot)
  const written: string[] = []
  const preserved: string[] = []
  const errors: WriteResult["errors"] = []

  for (const file of files) {
    const absPath = join(root, file.relativePath)
    try {
      const exists = await fileExists(absPath)
      const decision = await classifyFile(file, absPath, exists, Boolean(opts.force))

      if (decision === "preserve") {
        preserved.push(file.relativePath)
        if (!opts.quiet) console.log(`  preserved: ${file.relativePath}`)
        continue
      }

      await mkdir(dirname(absPath), { recursive: true })
      await writeFile(absPath, file.source, "utf-8")
      written.push(file.relativePath)
      if (!opts.quiet) console.log(`  wrote:     ${file.relativePath}`)
    } catch (e) {
      errors.push({ path: absPath, message: (e as Error).message })
    }
  }

  return { written, preserved, errors }
}

async function classifyFile(
  file: GeneratedFile,
  absPath: string,
  exists: boolean,
  force: boolean,
): Promise<"write" | "preserve"> {
  if (!exists) return "write"
  if (force) return "write"

  // _client.ts: preserve unless --force, regardless of marker (per spec §3 of the supplement)
  if (file.relativePath === "_client.ts") return "preserve"

  // For per-operation files: check the marker
  const existingContent = await readFile(absPath, "utf-8")
  if (existingContent.includes(OPENAPI_GENERATED_MARKER)) return "write"
  return "preserve"
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    return s.isFile()
  } catch {
    return false
  }
}
