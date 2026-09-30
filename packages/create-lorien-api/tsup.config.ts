import { defineConfig } from "tsup"

export default defineConfig({
  // templates is also imported by `lorien init` (@darrylondil/lorien-build).
  entry: { cli: "src/cli.ts", templates: "src/templates.ts" },
  format: ["esm"],
  dts: { entry: { templates: "src/templates.ts" } },
  clean: true,
  sourcemap: false,
  splitting: false,
  treeshake: false,
  banner: { js: "#!/usr/bin/env node" },
})
