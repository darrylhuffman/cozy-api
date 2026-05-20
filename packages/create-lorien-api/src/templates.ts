export interface TemplateContext {
  name: string;
}

export function renderPackageJson(ctx: TemplateContext): string {
  const pkg = {
    name: ctx.name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: "tsx src/server.ts",
      test: "vitest run",
      typecheck: "tsc --noEmit",
    },
    dependencies: {
      "@hono/node-server": "^1.13.0",
      hono: "^4.12.21",
      zod: "^4.4.3",
    },
    devDependencies: {
      "@darrylondil/lorien-runtime": "latest",
      "@types/node": "^25.9.1",
      tsx: "^4.20.0",
      typescript: "^6.0.3",
      vitest: "^4.1.7",
    },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export function renderTsconfig(): string {
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022"],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      types: ["node"],
    },
    include: [
      "src/**/*",
      "nodes/**/*",
      "lorien.config.ts",
      "workflows/**/*.test.ts",
    ],
  };
  return `${JSON.stringify(tsconfig, null, 2)}\n`;
}

export function renderBiomeJson(): string {
  const biome = {
    $schema: "https://biomejs.dev/schemas/2.4.15/schema.json",
    files: {
      includes: ["**", "!**/dist", "!**/node_modules", "!**/.lorien"],
    },
    formatter: {
      enabled: true,
      indentStyle: "space",
      indentWidth: 2,
      lineWidth: 100,
    },
    javascript: {
      formatter: {
        semicolons: "asNeeded",
        quoteStyle: "double",
        trailingCommas: "all",
      },
    },
    linter: {
      enabled: true,
      rules: { recommended: true },
    },
    assist: { actions: { source: { organizeImports: "on" } } },
  };
  return `${JSON.stringify(biome, null, 2)}\n`;
}

export function renderGitignore(): string {
  return [
    "node_modules/",
    "dist/",
    "*.tsbuildinfo",
    ".lorien/",
    "*.log",
    ".env",
    ".env.local",
    ".DS_Store",
    "Thumbs.db",
    "",
  ].join("\n");
}

export function renderLorienConfig(): string {
  return `import { defineConfig } from "@darrylondil/lorien-runtime"

export default defineConfig({
  target: "hono",
  services: {
    // Add your services here, e.g.:
    // db: createDb(process.env.DATABASE_URL),
    // logger: (ctx) => createLogger(ctx.requestId),
  },
})
`;
}

export function renderHelloWorkflow(): string {
  const wf = {
    lorien: 1,
    nodes: {
      request: {
        uses: "@core/http-request",
        config: { path: "/hello", method: "GET" },
      },
      say: {
        uses: "./nodes/say-hello",
        in: {},
      },
      response: {
        uses: "@core/response",
        in: { body: "say.greeting" },
      },
    },
  };
  return `${JSON.stringify(wf, null, 2)}\n`;
}

export function renderSayHelloNode(): string {
  return `import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"

export default defineNode({
  name: "Say Hello",
  inputs: z.object({}),
  outputs: z.object({ greeting: z.string() }),
  async run() {
    return { greeting: "Hello from lorien-api!" }
  },
})
`;
}

export function renderServerEntry(): string {
  return `import { serve } from "@hono/node-server"
import { startLorienServer } from "@darrylondil/lorien-runtime"

const app = await startLorienServer()
const port = Number(process.env.PORT) || 3000
serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(\`lorien-api listening on http://localhost:\${port}\`)
})
`;
}

export function renderAgentsMd(ctx: TemplateContext): string {
  return `# AI agent guide for ${ctx.name}

This project uses **lorien-api**: a file-based API framework where \`.workflow\`
files define HTTP endpoints as dependency graphs of typed nodes.

## Layout

- \`workflows/**/*.workflow\` — HTTP routes as JSON dependency graphs
- \`nodes/**/*.ts\` — typed compute units (via \`defineNode\` from \`@darrylondil/lorien-runtime\`)
- \`lorien.config.ts\` — service registry (db, logger, etc.)

## Adding a new endpoint

1. Create a node in \`nodes/\` (e.g., \`nodes/calculate.ts\`):

   \`\`\`ts
   import { defineNode } from "@darrylondil/lorien-runtime"
   import { z } from "zod"

   export default defineNode({
     name: "Calculate",
     inputs: z.object({ x: z.number() }),
     outputs: z.object({ result: z.number() }),
     async run({ x }) {
       return { result: x * 2 }
     },
   })
   \`\`\`

2. Create a workflow in \`workflows/\` (e.g., \`workflows/calc.workflow\`):

   \`\`\`json
   {
     "lorien": 1,
     "nodes": {
       "req": { "uses": "@core/http-request", "config": { "path": "/calc", "method": "POST" } },
       "calc": { "uses": "./nodes/calculate", "in": { "x": "req.body.x" } },
       "res": { "uses": "@core/response", "in": { "body": "calc.result" } }
     }
   }
   \`\`\`

3. Restart the dev server. \`POST /calc {"x": 5}\` returns \`10\`.

## References

- Documentation: https://lorien-api.dev (placeholder)
- @darrylondil/lorien-runtime API: \`testWorkflow\`, \`traceWorkflow\`, \`defineNode\`, \`defineConfig\`
`;
}

/** Returns the correct run prefix for the given package manager. */
function runCmd(pm: string, script: string): string {
  if (pm === "npm") return `npm run ${script}`;
  if (pm === "yarn") return `yarn ${script}`;
  if (pm === "bun") return `bun run ${script}`;
  // pnpm and others
  return `${pm} ${script}`;
}

export function renderReadme(ctx: TemplateContext, pm: string): string {
  return `# ${ctx.name}

API project built with [lorien-api](https://lorien-api.dev).

## Quickstart

\`\`\`
${runCmd(pm, "dev")}       # start dev server on port 3000
${runCmd(pm, "test")}      # run tests
\`\`\`

Then:

\`\`\`
curl http://localhost:3000/hello
# { "greeting": "Hello from lorien-api!" }
\`\`\`

## Layout

- \`workflows/\` — HTTP routes as \`.workflow\` JSON files
- \`nodes/\` — typed compute units (\`defineNode\` modules)
- \`lorien.config.ts\` — service registry

See [AGENTS.md](./AGENTS.md) for the author's guide.
`;
}
