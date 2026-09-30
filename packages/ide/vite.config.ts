import { cpSync, createReadStream, existsSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const require = createRequire(import.meta.url)
const MONACO_VS = join(dirname(require.resolve("monaco-editor/package.json")), "min", "vs")
const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".ttf": "font/ttf",
  ".json": "application/json",
}

/**
 * Ships the Monaco editor with the IDE (served at /monaco/vs) so the code
 * editor works offline instead of loading it from a CDN.
 */
function monacoAssets(): Plugin {
  let outDir = "dist"
  return {
    name: "lorien-monaco-assets",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use("/monaco/vs", (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/"))
        const file = join(MONACO_VS, rel)
        if (!file.startsWith(MONACO_VS) || !existsSync(file) || !statSync(file).isFile())
          return next()
        res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream")
        createReadStream(file).pipe(res)
      })
    },
    writeBundle() {
      cpSync(MONACO_VS, join(outDir, "monaco", "vs"), { recursive: true })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), monacoAssets()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3737",
        changeOrigin: true,
        // The terminal's socket lives under /api too.
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
})
