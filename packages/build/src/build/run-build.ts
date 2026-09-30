import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { loadWorkspace, validateWorkflow } from "@darrylondil/lorien-runtime"
import { emitIndex, emitWorkflow } from "../codegen/index.js"
import { generateServicesTypes } from "../generate-services-types.js"
import { bundleServer } from "./bundle-server.js"

export interface RunBuildOptions {
  root: string
  outDir: string
  skipTypes?: boolean
  /** Compile dist/index.ts into a runnable dist/index.js (default true). */
  bundle?: boolean
}

export interface RunBuildResult {
  ok: boolean
  outDir: string
  workflowsBuilt: number
  errors: Array<{ workflow: string; message: string }>
}

export async function runBuild(opts: RunBuildOptions): Promise<RunBuildResult> {
  const root = resolve(opts.root)
  const outDir = isAbsolute(opts.outDir) ? opts.outDir : resolve(root, opts.outDir)
  const errors: RunBuildResult["errors"] = []

  // Clean outDir
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  // Services types (unless skipped)
  if (!opts.skipTypes) {
    const typesResult = await generateServicesTypes(root)
    if (typesResult.path) {
      console.log(`✓ Generated ${typesResult.path}`)
    }
  }

  // Load workflows
  const ws = await loadWorkspace(root)
  if (ws.errors.length > 0) {
    for (const e of ws.errors) {
      console.error(`✗ ${e.path}: ${e.message}`)
      errors.push({ workflow: e.path, message: e.message })
    }
  }

  // Codegen each workflow
  const successfulPaths: string[] = []
  for (const wf of ws.workflows) {
    const { errors: validationErrors } = validateWorkflow(wf.file)
    if (validationErrors.length > 0) {
      for (const ve of validationErrors) {
        console.error(`✗ ${wf.relativePath} (${ve.nodeId}.${ve.field}): ${ve.message}`)
        errors.push({
          workflow: wf.relativePath,
          message: `${ve.nodeId}.${ve.field}: ${ve.message}`,
        })
      }
      continue
    }
    // Strip ".workflow" extension and the leading "workflows/" prefix (relativePath
    // is workspace-root-relative; codegen output is rooted at <outDir>/workflows/).
    const basePath = wf.relativePath.replace(/^workflows\//, "").replace(/\.workflow$/, "")
    const { source } = emitWorkflow({ workflow: wf.file, relativePath: basePath })

    // Slugify directory segments for the output path: [id] -> _id_
    const slugifiedPath = slugifyPath(basePath)
    const outPath = join(outDir, "workflows", `${slugifiedPath}.gen.ts`)
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, source, "utf-8")
    console.log(`✓ ${wf.relativePath} → ${outPath}`)
    successfulPaths.push(basePath)
  }

  // Emit dist/index.ts
  if (successfulPaths.length > 0) {
    const { source: indexSource } = emitIndex({ workflowPaths: successfulPaths })
    const indexPath = join(outDir, "index.ts")
    await writeFile(indexPath, indexSource, "utf-8")
    console.log(`✓ dist/index.ts`)
    if (opts.bundle !== false && errors.length === 0) {
      try {
        await bundleServer(root, outDir)
        console.log(`✓ dist/index.js (run it with \`node dist/index.js\`)`)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.error(`✗ bundling dist/index.js failed: ${message}`)
        errors.push({ workflow: "dist/index.js", message })
      }
    }
  }

  console.log(``)
  if (errors.length === 0) {
    console.log(`✓ Built ${successfulPaths.length} workflow(s) to ${outDir}`)
  } else {
    console.log(`✗ Built ${successfulPaths.length} workflow(s) with ${errors.length} error(s)`)
  }

  return {
    ok: errors.length === 0,
    outDir,
    workflowsBuilt: successfulPaths.length,
    errors,
  }
}

/** Mirror the codegen's directory-segment slugification: [id] -> _id_ */
function slugifyPath(p: string): string {
  return p
    .split("/")
    .map((seg) => seg.replace(/\[([^\]]+)\]/g, "_$1_"))
    .join("/")
}
