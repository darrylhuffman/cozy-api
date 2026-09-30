import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { build } from "esbuild"

/**
 * Compiles the generated `dist/index.ts` (and the nodes and lorien.config.ts
 * it imports) into a single runnable `dist/index.js`, so `node dist/index.js`
 * works without a TypeScript loader. The project's runtime `dependencies`
 * stay external and load from node_modules; everything else is inlined.
 */
export async function bundleServer(root: string, outDir: string): Promise<string> {
  let external: string[] = []
  try {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>
    }
    external = Object.keys(pkg.dependencies ?? {}).flatMap((d) => [d, `${d}/*`])
  } catch {
    // No package.json: bundle everything.
  }
  const outfile = join(outDir, "index.js")
  await build({
    entryPoints: [join(outDir, "index.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external,
    logLevel: "silent",
    // Bundled CommonJS dependencies may call require() for Node built-ins.
    banner: {
      js: 'import { createRequire as __lorienCreateRequire } from "node:module"; const require = __lorienCreateRequire(import.meta.url);',
    },
  })
  return outfile
}
