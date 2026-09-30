export interface TemplateContext {
  name: string
}

/**
 * Canonical authoring guide for AI agents working in a lorien-api project.
 * Used to render both AGENTS.md (no frontmatter) and .claude/skills/lorien-api/SKILL.md
 * (with frontmatter wrapper). Single source of truth — both renderers must use this.
 */
export const SKILL_BODY = `<!-- lorien-skill-version: 4 -->

# lorien-api project guide

This is a lorien-api project. HTTP endpoints are defined as \`.workflow\` files: named-input JSON dependency graphs of typed nodes. Workflows compile to plain TypeScript via \`lorien build\`; the deployed code has zero runtime dependency on lorien-api.

## Layout

\`\`\`
workflows/**/*.workflow   ← HTTP routes (you author these)
workflows/**/_middleware.ts ← middleware for every route in that folder and below
nodes/**/*.ts             ← typed compute units, one defineNode per file; ALL business logic
providers/<name>.ts       ← injected dependencies (db, logger, cache, clients), one defineProvider per file
providers/<name>/         ← code private to one provider (migrations, SQL, client setup)
lib/                      ← plain shared code: zod schemas, helpers
lorien.config.ts          ← build target only
.lorien/                  ← IDE cache and generated types, do not edit
.lorien/chats/            ← agent chat transcripts, do not edit
\`\`\`

## The node contract

Every node is exactly one file under \`nodes/\`. Filename is the node name in kebab-case. One default export, returning \`defineNode(...)\`:

\`\`\`ts
import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"

export default defineNode({
  name: "Save User",
  inputs: z.object({
    email: z.string().email(),
    passwordHash: z.string(),
  }),
  outputs: z.object({
    id: z.string(),
  }),
  async run({ email, passwordHash }, { db }) {
    const row = await db.users.insert({ email, passwordHash })
    return { id: row.id }
  },
})
\`\`\`

Rules:
- \`inputs\` and \`outputs\` are Zod object schemas.
- \`run\` is \`async\`; receives the typed input and the providers (destructure the ones you need; each is typed from its \`providers/<name>.ts\`).
- Don't throw. Return shaped errors via the output schema if needed.
- One node per file. Filename kebab-case. Export default.

## The .workflow file format

Named-input JSON. Each node lists where its inputs come from inline. No separate edges list:

\`\`\`jsonc
{
  "lorien": 1,
  "nodes": {
    "request": {
      "uses": "@core/http-request",
      "values": { "path": "/users", "method": "POST" }
    },
    "parseBody": {
      "uses": "./nodes/parse-body",
      "in": { "raw": "request.body" }
    },
    "saveUser": {
      "uses": "./nodes/save-user",
      "in": {
        "email": "parseBody.email",
        "passwordHash": "parseBody.passwordHash"
      }
    },
    "response": {
      "uses": "@core/response",
      "in": { "body": "saveUser" }
    }
  }
}
\`\`\`

Rules:
- Keys in \`in\` must match the target node's \`inputs\` schema.
- Values in \`in\` are \`<nodeId>.<outputField>\` references (or just \`<nodeId>\` to pass the whole output object).
- No cycles.
- A \`view\` block (when present) is IDE-only layout metadata. After hand-editing, you may set it to \`null\` and the IDE will re-lay-out.

## Authoring recipes

**Add a new node**
1. Create \`nodes/<name>.ts\` following the node contract.
2. Reference it from a workflow via \`"uses": "./nodes/<name>"\`.

**Wire a new node into a workflow**
1. Add an entry under \`nodes\` with \`uses\` pointing to the node file.
2. In its \`in\` block, reference upstream outputs as \`<id>.<field>\`.

**Add a provider (db, logger, cache, API client)**
1. Create \`providers/<name>.ts\` exporting \`defineProvider({ lifetime, env, uses, create, dispose })\`. The file name is the name nodes read it by (\`http-client.ts\` → \`httpClient\`).
2. Pick a lifetime: \`singleton\` (default, once at boot: pools, clients), \`scoped\` (once per request: a logger tagged with the request id), or \`transient\` (every read). A singleton may only \`uses\` other singletons.
3. Declare env vars in \`env\` (a zod object); boot fails with a clear message when one is missing. Don't read \`process.env\` in nodes.
4. Destructure it from the second argument of \`run()\` in any node that needs it.

\`\`\`ts
// providers/db.ts
import { defineProvider } from "@darrylondil/lorien-runtime"
import { z } from "zod"
import { Pool } from "pg"

export default defineProvider({
  env: z.object({ DATABASE_URL: z.string() }),
  create: ({ env }) => new Pool({ connectionString: env.DATABASE_URL }),
  dispose: (pool) => pool.end(),
})
\`\`\`

**Add middleware (auth, CORS, rate limits, request logging)**
1. Create \`_middleware.ts\` in the \`workflows/\` folder whose routes it guards: \`workflows/_middleware.ts\` runs before every route, \`workflows/admin/_middleware.ts\` before \`workflows/admin/**\` only. Outer folders run first.
2. Export \`defineMiddleware({ name, run(c, next, providers) })\`, or an array of them to run several in order. \`c\` is Hono's context: return a response to stop, or \`await next()\` to continue. It reads providers like a node does.

\`\`\`ts
// workflows/admin/_middleware.ts
import { defineMiddleware } from "@darrylondil/lorien-runtime"

export default defineMiddleware({
  name: "Require admin key",
  async run(c, next) {
    if (c.req.header("x-admin-key") !== process.env.ADMIN_KEY) {
      return c.json({ error: "forbidden" }, 403)
    }
    await next()
  },
})
\`\`\`

## Where things go

| You're adding | Put it in |
| --- | --- |
| A database, cache, queue, logger or third-party API client | \`providers/<name>.ts\` |
| Anything that decides, validates, transforms or queries data for a route | a node in \`nodes/\` |
| A zod schema or helper shared by several nodes | \`lib/\` |
| A new HTTP route | \`workflows/<path>.workflow\` |
| Auth, CORS, rate limits or request logging for a group of routes | \`workflows/<folder>/_middleware.ts\` |

Providers export only \`create\`/\`dispose\`: never a \`users.ts\` provider with \`createUser()\` — that is a node. Don't create new top-level folders.

**Add an OpenAPI-typed HTTP client**
1. Run \`lorien openapi add <url-or-path>\`.
2. Generated client nodes appear under \`nodes/<api>/\` — use them like any other node.

## Verification

After edits, run (any package manager works — \`npm\`, \`pnpm\`, \`yarn\`, \`bun\`):

\`\`\`
npm run typecheck && npm run test
\`\`\`

Tests live next to nodes in \`*.test.ts\` files and use \`testWorkflow\` / \`traceWorkflow\` from \`@darrylondil/lorien-runtime/testing\`.

## Node test cases and saved requests

The IDE's Tests and Run tabs read two JSON files. Write them by hand or from the IDE; both are checked by \`lorien test\`.

**Node cases**: \`nodes/<path>/<node>.cases.json\` next to \`<node>.ts\`:

\`\`\`json
{ "lorien": 1, "cases": [
  { "id": "saves-user", "name": "saves a user", "input": { "email": "a@b.co" },
    "mocks": { "db": { "insert": { "returns": { "id": "u1" } } } },
    "expect": { "output": { "id": "u1" } } },
  { "id": "rejects-bad-email", "name": "rejects a bad email", "input": { "email": "x" },
    "expect": { "error": "email" } }
] }
\`\`\`

\`expect.output\` matches as a subset unless \`"match": "equals"\`. \`expect.error\` passes when the message contains the text. \`mocks\` replace a provider's methods with \`{ "returns": value }\` or \`{ "throws": "message" }\`.

**Saved requests**: \`workflows/<path>/<workflow>.requests.json\` next to the \`.workflow\` file:

\`\`\`json
{ "lorien": 1, "requests": [
  { "id": "create-user", "name": "create a user", "method": "POST", "path": "/users",
    "body": { "kind": "json", "json": { "email": "{{userPrefix}}-{{$uuid}}@b.co" } },
    "expect": [ { "target": "status", "op": "equals", "value": 201 },
                { "target": "body", "path": "id", "op": "exists" } ],
    "capture": { "userId": "body.id" } }
] }
\`\`\`

Checks: \`target\` is \`status\`, \`header\`, \`body\` or \`duration\`; \`op\` is \`equals\`, \`notEquals\`, \`contains\`, \`exists\`, \`notExists\`, \`matches\`, \`lessThan\`, \`greaterThan\` or \`type\`. \`{{name}}\` reads variables from \`lorien.environments.json\` (\`lorien.environments.local.json\` overrides it and stays out of git), from earlier captures, or the built-ins \`$uuid\`, \`$timestamp\`, \`$isoTimestamp\`, \`$randomInt\`.

Run everything with \`npx lorien test\` (\`--env <name>\`, \`--base-url <url>\` to hit a running server, \`--no-nodes\`, \`--no-requests\`, \`--json\`, and an optional name filter).

## What you should NOT do

- Don't add \`@darrylondil/lorien-runtime\` as a *runtime* dep in user code — it's build-time only. The compiled output has no runtime dep on lorien.
- Don't hand-edit anything under \`.lorien/\` (IDE cache + chat transcripts).
- Don't introduce an edges-array workflow format. lorien-api is named-input style: each node declares its own inputs.
- Don't use middleware for error handling or business logic. Handle errors at the node level by returning shaped output; middleware is for auth, CORS, rate limits and request logging.
`

export function renderPackageJson(ctx: TemplateContext): string {
  const pkg = {
    name: ctx.name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: "lorien dev",
      "dev:server": "lorien dev --no-ide",
      build: "lorien build",
      start: "node dist/index.js",
      test: "vitest run",
      typecheck: "tsc --noEmit",
    },
    dependencies: {
      "@hono/node-server": "^1.13.0",
      hono: "^4.12.21",
      zod: "^4.4.3",
    },
    devDependencies: {
      "@darrylondil/lorien-build": "latest",
      "@darrylondil/lorien-runtime": "latest",
      "@types/node": "^25.9.1",
      tsx: "^4.20.0",
      typescript: "^6.0.3",
      vitest: "^4.1.7",
    },
  }
  return `${JSON.stringify(pkg, null, 2)}\n`
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
      "providers/**/*",
      "lib/**/*",
      "lorien.config.ts",
      "workflows/**/*.test.ts",
      "workflows/**/_middleware.ts",
      ".lorien/types/**/*",
    ],
  }
  return `${JSON.stringify(tsconfig, null, 2)}\n`
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
  }
  return `${JSON.stringify(biome, null, 2)}\n`
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
  ].join("\n")
}

export function renderLorienConfig(): string {
  return `import { defineConfig } from "@darrylondil/lorien-runtime"

// Databases, loggers and clients go in providers/<name>.ts, one defineProvider each.
export default defineConfig({
  target: "hono",
})
`
}

export function renderHelloWorkflow(): string {
  const wf = {
    lorien: 1,
    nodes: {
      request: {
        uses: "@core/http-request",
        values: { path: "/hello", method: "GET" },
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
  }
  return `${JSON.stringify(wf, null, 2)}\n`
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
`
}

export function renderServerEntry(): string {
  return `import { serve } from "@hono/node-server"
import { startLorienServer } from "@darrylondil/lorien-runtime"
import { attachAgentBroker, mountAgentBroker } from "@darrylondil/lorien-runtime/agent-broker"

const app = await startLorienServer()
mountAgentBroker(app, { projectRoot: process.cwd() })

const port = Number(process.env.PORT) || 3000
const server = serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(\`lorien-api listening on http://localhost:\${port}\`)
})
attachAgentBroker({ app, server, projectRoot: process.cwd() })
`
}

export function renderAgentsMd(): string {
  return SKILL_BODY
}

/**
 * Renders the Claude Code skill file (.claude/skills/lorien-api/SKILL.md).
 * Wraps SKILL_BODY in YAML frontmatter so Claude auto-loads it when working
 * in the project. The `description` is what Claude reads to decide whether
 * the skill applies to the current task.
 */
export function renderClaudeSkill(): string {
  const frontmatter = [
    "---",
    "name: lorien-api",
    "description: Use when authoring or editing files in a lorien-api project — workflows (.workflow JSON dependency graphs), nodes (typed defineNode modules), providers (defineProvider dependencies like a db or logger), or middleware (workflows/**/_middleware.ts). Triggers on edits in workflows/, nodes/, providers/, or any file ending in .workflow.",
    "---",
    "",
  ].join("\n")
  return `${frontmatter}\n${SKILL_BODY}`
}

/** Returns the correct run prefix for the given package manager. */
function runCmd(pm: string, script: string): string {
  if (pm === "npm") return `npm run ${script}`
  if (pm === "yarn") return `yarn ${script}`
  if (pm === "bun") return `bun run ${script}`
  // pnpm and others
  return `${pm} ${script}`
}

export function renderReadme(ctx: TemplateContext, pm: string): string {
  return `# ${ctx.name}

API project built with [lorien-api](https://lorien-api.dev).

## Quickstart

\`\`\`
${runCmd(pm, "dev")}        # start dev server and open the IDE
${runCmd(pm, "dev:server")} # start dev server without the IDE
${runCmd(pm, "build")}      # generate dist/
${runCmd(pm, "test")}       # run tests
\`\`\`

Then:

\`\`\`
curl http://localhost:3000/hello
# { "greeting": "Hello from lorien-api!" }
\`\`\`

## Layout

- \`workflows/\` — HTTP routes as \`.workflow\` JSON files
- \`nodes/\` — typed compute units (\`defineNode\` modules)
- \`providers/\` — injected dependencies (db, logger, clients)
- \`workflows/**/_middleware.ts\` — middleware for the routes in that folder
- \`lorien.config.ts\` — build target

See [AGENTS.md](./AGENTS.md) for the author's guide.
`
}
