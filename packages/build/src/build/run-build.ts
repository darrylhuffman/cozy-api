import { spawnSync } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import {
  checkWiring,
  findMiddlewareFiles,
  findProviderFiles,
  findRouteConflicts,
  importLegacyServices,
  importMiddleware,
  importNodes,
  importProviders,
  loadWorkspace,
  middlewareChain,
  planProviders,
  preflightRoutes,
  resolveCoreNode,
  validateWorkflow,
} from "@darrylondil/lorien-runtime"
import { formatFinding, runCheck } from "../check/run-check.js"
import { type EmitProviderInfo, emitIndex, emitProviders, emitWorkflow } from "../codegen/index.js"
import { generateServicesTypes } from "../generate-services-types.js"
import { withProjectBin } from "../project-bin.js"
import { bundleServer } from "./bundle-server.js"

export interface RunBuildOptions {
  root: string
  outDir: string
  skipTypes?: boolean
  /** Compile dist/index.ts into a runnable dist/index.js (default true). */
  bundle?: boolean
  /** Run the project's `tsc --noEmit` after generating types; type errors fail the build. */
  typecheck?: boolean
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

  if (opts.typecheck) {
    const tsc = typecheckProject(root)
    if (!tsc.ok) {
      console.error(`✗ Type errors (tsc --noEmit); fix them or build without --typecheck`)
      return {
        ok: false,
        outDir,
        workflowsBuilt: 0,
        errors: [{ workflow: "tsc", message: tsc.message }],
      }
    }
    console.log(`✓ Typechecked`)
  }

  // Providers: import each (without creating it) to learn its lifetime and deps.
  const providerFiles = await findProviderFiles(root)
  const imported = await importProviders(root)
  for (const e of imported.errors) {
    console.error(`✗ ${e.path}: ${e.message}`)
    errors.push({ workflow: e.path, message: e.message })
  }
  let legacyServices: Record<string, unknown> = {}
  try {
    legacyServices = await importLegacyServices(root)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`✗ lorien.config.ts: ${message}`)
    errors.push({ workflow: "lorien.config.ts", message })
  }
  const legacyNames = Object.keys(legacyServices)
  const plan = planProviders(
    Object.entries(imported.providers).map(([name, p]) => ({
      name,
      lifetime: p.lifetime,
      uses: p.uses,
    })),
    legacyNames,
  )
  for (const message of plan.errors) {
    console.error(`✗ providers: ${message}`)
    errors.push({ workflow: "providers", message })
  }
  const providerInfos: EmitProviderInfo[] = plan.order.map((name) => {
    const p = imported.providers[name]!
    return {
      name,
      path: providerFiles.find((f) => f.name === name)!.path,
      lifetime: p.lifetime,
      uses: p.uses,
      hasEnv: p.env !== undefined,
      hasDispose: typeof p.dispose === "function",
    }
  })
  const providersGen = emitProviders({
    providers: providerInfos,
    legacy: {
      values: legacyNames.filter((n) => typeof legacyServices[n] !== "function"),
      factories: legacyNames.filter((n) => typeof legacyServices[n] === "function"),
    },
  })
  await writeFile(join(outDir, "providers.gen.ts"), providersGen.source, "utf-8")
  if (providerInfos.length > 0)
    console.log(`✓ ${providerInfos.length} provider(s) → dist/providers.gen.ts`)

  // workflows/**/_middleware.ts: checked here, imported statically by each route
  const middleware = await importMiddleware(root)
  for (const e of middleware.errors) {
    console.error(`✗ ${e.path}: ${e.message}`)
    errors.push({ workflow: e.path, message: e.message })
  }
  const middlewareFiles = (await findMiddlewareFiles(root)).filter(
    (f) => middleware.byDir[f.dir] !== undefined,
  )

  // lorien check's warnings (its errors are the provider errors above).
  for (const f of (await runCheck(root)).findings) {
    if (f.severity === "warning") console.warn(formatFinding(f))
  }

  // Load workflows
  const ws = await loadWorkspace(root)
  if (ws.errors.length > 0) {
    for (const e of ws.errors) {
      console.error(`✗ ${e.path}: ${e.message}`)
      errors.push({ workflow: e.path, message: e.message })
    }
  }

  // Two workflows serving one route: the built server would silently answer
  // with one of them.
  for (const conflict of findRouteConflicts(ws.workflows)) {
    const message = `${conflict.method} ${conflict.path} is served by more than one workflow: ${conflict.sources.join(", ")}`
    console.error(`✗ ${message}`)
    errors.push({ workflow: conflict.sources[0]!.split("#")[0]!, message })
  }

  // Nodes are imported (not run) so each workflow can be checked against their schemas.
  const nodeImports = await importNodes(root)
  for (const e of nodeImports.errors) {
    const path = relative(root, e.path).replaceAll("\\", "/")
    console.error(`✗ ${path}: ${e.message}`)
    errors.push({ workflow: path, message: e.message })
  }
  const resolveNode = (uses: string) => resolveCoreNode(uses) ?? nodeImports.nodes[uses] ?? null

  // Which workflows are valid, so preflight routes are planned from those only.
  const valid = ws.workflows.filter((wf) => {
    const { errors: shapeErrors } = validateWorkflow(wf.file)
    if (shapeErrors.length > 0) return false
    return nodeImports.errors.length > 0 || checkWiring(wf.file, resolveNode).length === 0
  })
  const preflights = preflightRoutes(
    valid,
    middlewareFiles.map((f) => f.dir),
  )

  // Codegen each workflow
  const successfulPaths: string[] = []
  const scheduledPaths: string[] = []
  for (const wf of ws.workflows) {
    const { errors: shapeErrors } = validateWorkflow(wf.file)
    // Wiring needs the shape to be valid first; skip it when a node failed to import.
    const validationErrors =
      shapeErrors.length > 0 || nodeImports.errors.length > 0
        ? shapeErrors
        : checkWiring(wf.file, resolveNode)
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
    const { source, hasSchedules } = emitWorkflow({
      workflow: wf.file,
      relativePath: basePath,
      perRequestProviders: providersGen.perRequest,
      middleware: middlewareChain(wf.relativePath, middlewareFiles).map((f) => f.path),
      preflight: preflights
        .filter((p) => p.owner === wf.relativePath)
        .map((p) => ({ path: p.path, methods: p.methods, depth: p.dirs.length })),
    })

    // Slugify directory segments for the output path: [id] -> _id_
    const slugifiedPath = slugifyPath(basePath)
    const outPath = join(outDir, "workflows", `${slugifiedPath}.gen.ts`)
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, source, "utf-8")
    console.log(`✓ ${wf.relativePath} → ${outPath}`)
    successfulPaths.push(basePath)
    if (hasSchedules) scheduledPaths.push(basePath)
  }

  if (scheduledPaths.length > 0) {
    await copyScheduleModule(outDir)
    console.log(`✓ dist/schedule.gen.js (${scheduledPaths.length} scheduled workflow(s))`)
  }

  // Emit dist/index.ts
  if (successfulPaths.length > 0) {
    const { source: indexSource } = emitIndex({
      workflowPaths: successfulPaths,
      disposeOnExit: providerInfos.some((p) => p.lifetime === "singleton" && p.hasDispose),
      scheduledPaths,
    })
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

/**
 * Copies the runtime's compiled cron scheduler (it imports nothing) into the
 * build, so the server runs schedules without the runtime package.
 */
async function copyScheduleModule(outDir: string): Promise<void> {
  const js = createRequire(import.meta.url).resolve("@darrylondil/lorien-runtime/schedule")
  const strip = (s: string) => s.replace(/\n\/\/# sourceMappingURL=.*\s*$/, "\n")
  const header =
    "// Copied from @darrylondil/lorien-runtime/schedule by lorien build. Do not edit.\n"
  await writeFile(join(outDir, "schedule.gen.js"), header + strip(await readFile(js, "utf-8")))
  await writeFile(
    join(outDir, "schedule.gen.d.ts"),
    header + (await readFile(js.replace(/\.js$/, ".d.ts"), "utf-8")),
  )
}

/** Mirror the codegen's directory-segment slugification: [id] -> _id_ */
function slugifyPath(p: string): string {
  return p
    .split("/")
    .map((seg) => seg.replace(/\[([^\]]+)\]/g, "_$1_"))
    .join("/")
}

/** Runs the project's own TypeScript (node_modules/.bin/tsc) with its tsconfig, printing errors. */
function typecheckProject(root: string): { ok: boolean; message: string } {
  const r = spawnSync("tsc", ["--noEmit", "-p", root], {
    cwd: root,
    env: withProjectBin(root, process.env),
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (r.error) return { ok: false, message: `couldn't run tsc: ${r.error.message}` }
  return { ok: r.status === 0, message: `tsc --noEmit exited with ${r.status}` }
}
