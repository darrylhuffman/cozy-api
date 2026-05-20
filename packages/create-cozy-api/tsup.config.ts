import { defineConfig } from "tsup"

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: false,
  splitting: false,
  treeshake: false,
  banner: { js: "#!/usr/bin/env node" },
})
