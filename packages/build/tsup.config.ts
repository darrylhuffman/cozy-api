import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    "run-build": "src/build/run-build.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  splitting: false,
  treeshake: false,
  banner: { js: "#!/usr/bin/env node" },
})
