import type { Monaco } from "@monaco-editor/react"
import { fetchWorkspaceTypes } from "@/lib/api"

let loading: Promise<void> | null = null

/**
 * Makes Monaco's TypeScript service check node files the way the project's
 * own `tsc` does: ESM + bundler-style resolution (so package `exports` and
 * `types` conditions work), and the workspace's installed package typings
 * mounted under `file:///node_modules`. Without this every package import
 * reports "Cannot find module" (2792).
 *
 * Runs once per page load; later editors share the same language service.
 */
export function setupWorkspaceTypes(monaco: Monaco): Promise<void> {
  if (loading) return loading
  const ts = monaco.typescript
  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    // Bundler (100) isn't in Monaco's enum typings, but its TypeScript supports it.
    moduleResolution: 100 as unknown as typeof ts.ModuleResolutionKind.NodeJs,
    moduleDetection: 3, // force: every file is a module
    strict: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    allowNonTsExtensions: true,
    isolatedModules: true,
  })
  // Keep every open model in the program so cross-file edits are seen at once.
  ts.typescriptDefaults.setEagerModelSync(true)

  loading = fetchWorkspaceTypes()
    .then((files) => {
      ts.typescriptDefaults.setExtraLibs(
        files.map((f) => ({ content: f.content, filePath: `file:///${f.path}` })),
      )
    })
    .catch(() => {
      // Offline or an older server without the endpoint: keep the editor
      // usable and let the next editor mount try again.
      loading = null
    })
  return loading
}
