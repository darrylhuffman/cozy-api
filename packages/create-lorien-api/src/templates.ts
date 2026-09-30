export interface TemplateContext {
  name: string
}

/**
 * Canonical authoring guide for AI agents working in a lorien project.
 * Used to render both AGENTS.md (no frontmatter) and .claude/skills/lorien-api/SKILL.md
 * (with frontmatter wrapper). Single source of truth — both renderers must use this.
 */
export const SKILL_BODY = `<!-- lorien-skill-version: 5 -->

# lorien project guide

This is a lorien project. Each HTTP route is a \`.workflow\` file: a small JSON graph of typed nodes, where each node says where its inputs come from. \`lorien build\` compiles the workflows to plain TypeScript and Hono in \`dist/\`.

## Layout

\`\`\`
workflows/**/*.workflow          ← HTTP routes (you author these)
workflows/**/*.requests.json     ← saved requests for that route (tests)
workflows/**/_middleware.ts      ← middleware for every route in that folder and below
nodes/**/*.ts                    ← typed compute units, one defineNode per file; ALL business logic
nodes/**/*.cases.json            ← test cases for the node next to it
providers/**/<name>.ts           ← injected dependencies (db, logger, cache, clients), one defineProvider per file, read by its selector
providers/<name>/                ← code private to one provider (migrations, SQL, client setup)
lib/                             ← plain shared code: zod schemas, helpers
src/server.ts                    ← dev server entry (lorien dev runs it); not part of the build
lorien.config.ts                 ← build target only
.lorien/                         ← IDE cache and generated types, do not edit
\`\`\`

## Commands

| Command | What it does |
| --- | --- |
| \`npm run dev\` | API on :3000 and the IDE on :8188. Restarts when a node, provider, middleware or workflow changes. Loads \`.env\` if present. |
| \`npm run dev:server\` | The API only, no IDE. |
| \`npm run build\` | Checks every workflow and writes \`dist/\`; \`npm start\` runs \`dist/index.js\`. |
| \`npm run test\` | \`lorien test\` (every node case and saved request), then Vitest. |
| \`npm run typecheck\` | \`lorien types\` (writes \`.lorien/types/providers.d.ts\`, git-ignored), then \`tsc\`. |

Any package manager works (\`pnpm\`, \`yarn\`, \`bun\`). \`npx lorien --help\` lists every command.

## The node contract

Every node is exactly one file under \`nodes/\`. Filename is the node name in kebab-case. One default export, returning \`defineNode(...)\`:

\`\`\`ts
import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"

export default defineNode({
  name: "Find Room",
  inputs: z.object({ id: z.coerce.number().int() }),
  outputs: z.object({
    found: z.boolean(),
    room: z.object({ id: z.number(), name: z.string() }).optional(),
  }),
  async run({ id }, { db }) {
    const room = await db.findRoom(id)
    return room ? { found: true, room } : { found: false }
  },
})
\`\`\`

Rules:
- \`inputs\` and \`outputs\` are Zod object schemas. \`run\` receives the parsed input and the providers (destructure the ones you need, by selector; each is typed from its provider).
- Path params, query values and headers are always strings: use \`z.coerce.number()\` / \`z.coerce.boolean()\` for them.
- \`await\` provider calls, even synchronous ones: test mocks may stand in for them.
- Expected failures (not found, conflict, forbidden) are outputs, not throws: return a flag like \`found\` or a \`status\`, and branch on it in the workflow (see "Status codes and branching"). A throw is a bug and answers 500.
- One node per file. Filename kebab-case. Export default.

## The .workflow file format

Named-input JSON. Each node lists where its inputs come from. No separate edges list:

\`\`\`json
{
  "lorien": 1,
  "nodes": {
    "Request": {
      "uses": "@core/http-request",
      "values": { "path": "/rooms/:id", "method": "GET" }
    },
    "FindRoom": {
      "uses": "./nodes/rooms/find-room",
      "in": { "id": "Request.params.id" }
    },
    "Response": {
      "uses": "@core/response",
      "in": { "body": "FindRoom.room" }
    }
  }
}
\`\`\`

A node instance has only these keys; any other key is an error:

| Key | Meaning |
| --- | --- |
| \`uses\` | \`@core/...\` or \`./nodes/<path>\` without \`.ts\`. |
| \`in\` | \`{ "<input>": "<NodeId>.<output>.<path>" }\` references, or one reference string that becomes the whole input (\`"in": "Request.body"\`). References only, never literals. |
| \`values\` | Literal inputs (\`{ "status": 201 }\`). A field in both \`in\` and \`values\` takes the \`in\` reference. With the whole-object form of \`in\`, \`values\` is ignored. |
| \`when\` | Run this node only when a reference is truthy (\`"FindRoom.found"\`), or falsy with a leading \`!\` (\`"!FindRoom.found"\`). |
| \`after\` | Node ids this node waits for without reading their outputs. |
| \`label\` | Display name on the canvas. |

Rules:
- Reference segments are identifiers: letters, digits, \`_\` and \`$\`. A header like \`x-api-key\` can't be referenced directly: take \`Request.headers\` whole into a node, or check it in middleware.
- No cycles. Nodes whose inputs are ready run in parallel.
- To share one value between several inputs, add a variable: \`"role": { "uses": "@core/variable", "values": { "value": "admin" } }\`, read as \`role.value\`.
- A \`view\` block (when present) is IDE-only layout. After hand-editing, you may delete it and the IDE will lay the graph out again.

## Core nodes

**\`@core/http-request\`** (the trigger): \`values.method\` (\`GET\` by default; \`POST\`, \`PUT\`, \`PATCH\`, \`DELETE\`, \`OPTIONS\`) and \`values.path\` (Hono syntax, \`/rooms/:id\`; defaults to the workflow's folder: \`workflows/rooms/list.workflow\` serves \`/rooms\`). Outputs:
- \`body\`: the parsed JSON body; raw text for other content types; \`null\` when there is none or the JSON is malformed.
- \`params\`: path params, as strings.
- \`query\`: query values, as strings (a repeated key keeps the last value; a missing one is \`undefined\`).
- \`headers\`: request headers, names lowercased.
- \`context.requestId\`, \`context.timestamp\`.

The route comes from \`values.path\`, not from where the file sits. Two workflows serving the same method and path fail the build.

**\`@core/response\`**: inputs \`body\`, \`status\` (default 200) and \`headers\`. The first Response that runs answers the request.

**\`@core/variable\`**: a constant, \`values.value\`, read as \`<id>.value\`.

## Status codes and branching

Every node runs unless its \`when\` says otherwise. A node that doesn't run is skipped along with every node that reads its outputs. Give each outcome its own Response with a \`when\`:

\`\`\`json
{
  "lorien": 1,
  "nodes": {
    "Request": { "uses": "@core/http-request", "values": { "path": "/bookings", "method": "POST" } },
    "FindRoom": { "uses": "./nodes/rooms/find-room", "in": { "id": "Request.body.roomId" } },
    "NoRoom": {
      "uses": "@core/response",
      "when": "!FindRoom.found",
      "values": { "status": 404, "body": { "error": "room not found" } }
    },
    "CheckOverlap": {
      "uses": "./nodes/bookings/check-overlap",
      "when": "FindRoom.found",
      "in": { "roomId": "FindRoom.room.id", "from": "Request.body.from", "to": "Request.body.to" }
    },
    "Taken": {
      "uses": "@core/response",
      "when": "CheckOverlap.overlaps",
      "values": { "status": 409, "body": { "error": "room already booked" } }
    },
    "Insert": {
      "uses": "./nodes/bookings/insert-booking",
      "when": "!CheckOverlap.overlaps",
      "in": { "roomId": "FindRoom.room.id", "from": "Request.body.from", "to": "Request.body.to" }
    },
    "Created": {
      "uses": "@core/response",
      "in": { "body": "Insert.booking", "headers": "Insert.headers" },
      "values": { "status": 201 }
    }
  }
}
\`\`\`

A node can also compute its own status and pass it on: wire \`"status": "Node.status"\` and \`"body": "Node.body"\` into a Response.

What lorien answers for you:
- **400** when a value that came straight from the request fails a node's input schema: \`{ "error": "Invalid request", "issues": [{ "path": "query.minCapacity", "message": "..." }] }\`.
- **500** when a node throws: \`{ "error": "Internal Server Error" }\`, with the error logged. \`lorien dev\` adds the message as \`detail\`.

## Providers (db, logger, cache, API client)

1. Create \`providers/<name>.ts\` (folders are fine: \`providers/aws/s3.ts\`) exporting \`defineProvider({ selector, color, lifetime, env, uses, create, dispose })\`. \`selector\` is required and is the name nodes read it by: a string literal, starting with a letter, then letters, digits, \`_\` or \`-\`. Use camelCase (\`httpClient\`): a dashed selector must be quoted everywhere (\`{ "http-client": http }\`, \`providers["http-client"]\`). Name the file after the selector, and put a one-sentence doc comment above \`defineProvider\` to describe it (the IDE shows it on the provider's card).
2. \`lifetime\`: \`singleton\` (default, created once at boot: pools, clients), \`scoped\` (once per request: a logger tagged with the request id), or \`transient\` (every read). A singleton may only \`uses\` other singletons.
3. \`env\` is a zod object of env vars, checked at boot with a clear error. Set them in \`.env\` (loaded by \`lorien dev\`) or the shell. Don't read \`process.env\` in nodes.
4. \`create({ env, providers, request })\` returns the value nodes receive. \`providers\` holds the ones listed in \`uses\`; \`request\` (\`requestId\`, \`timestamp\`) is set for scoped and transient providers. \`dispose(value)\` runs at shutdown (or at the end of the request, for scoped).
5. Nodes destructure it from \`run\`'s second argument. Its type comes from \`.lorien/types/providers.d.ts\`, which \`npm run typecheck\`, \`npm run dev\` and \`npm run build\` regenerate.

\`\`\`ts
// providers/db.ts
import { defineProvider } from "@darrylondil/lorien-runtime"
import { z } from "zod"
import { openBookingsDb } from "./db/open.js"

/** The bookings database, opened once at boot and shared by every request. */
export default defineProvider({
  selector: "db",
  env: z.object({ BOOKINGS_DB: z.string().default("data/bookings.db") }),
  create: ({ env }) => openBookingsDb(env.BOOKINGS_DB),
  dispose: (db) => db.close(),
})
\`\`\`

A provider can expose a client or small data-access methods (\`findRoom\`, \`insertBooking\`). Decisions (can this booking go ahead?) belong in nodes. Methods keep nodes easy to test: a node case mocks them by name.

## Middleware (auth, CORS, rate limits, request logging)

1. Create \`_middleware.ts\` in the \`workflows/\` folder whose routes it guards: \`workflows/_middleware.ts\` runs before every route, \`workflows/admin/_middleware.ts\` before \`workflows/admin/**\` only. Outer folders run first.
2. Export \`defineMiddleware({ name, run(c, next, providers) })\`, or an array of them to run several in order. \`c\` is Hono's context: return a response to stop, or \`await next()\` to continue. It reads providers like a node does.

\`\`\`ts
// workflows/admin/_middleware.ts
import { defineMiddleware } from "@darrylondil/lorien-runtime"

export default defineMiddleware({
  name: "Require admin key",
  async run(c, next, { authConfig }) {
    if (!authConfig.keys.includes(c.req.header("x-api-key") ?? "")) {
      return c.json({ error: "unauthorized" }, 401)
    }
    await next()
  },
})
\`\`\`

Use middleware for checks that stop a request before any node runs; use \`when\` for outcomes that depend on what nodes found.

## Where things go

| You're adding | Put it in |
| --- | --- |
| A database, cache, queue, logger or third-party API client | \`providers/<name>.ts\` with a \`selector\` |
| Anything that decides, validates, transforms or queries data for a route | a node in \`nodes/\` |
| A zod schema or helper shared by several nodes | \`lib/\` |
| A new HTTP route | \`workflows/<path>.workflow\` |
| Auth, CORS, rate limits or request logging for a group of routes | \`workflows/<folder>/_middleware.ts\` |

Don't create new top-level folders.

**Add an OpenAPI-typed HTTP client**: \`npx lorien import-openapi <spec.json>\` (a local OpenAPI 3.x JSON file; \`--out\`, \`--api-slug\`, \`--base-url\`). Generated client nodes appear under \`nodes/<api>/\`; use them like any other node.

## Tests

Two JSON test files, both run by \`lorien test\` and shown in the IDE's Tests and Run tabs.

**Node cases**: \`nodes/<path>/<node>.cases.json\`, next to \`<node>.ts\`:

\`\`\`json
{ "lorien": 1, "cases": [
  { "id": "finds-room", "name": "finds a room", "input": { "id": 1 },
    "mocks": { "db": { "findRoom": { "returns": { "id": 1, "name": "Oak" } } } },
    "expect": { "output": { "found": true } } },
  { "id": "db-down", "name": "db down", "input": { "id": 1 },
    "mocks": { "db": { "findRoom": { "throws": "database is locked" } } },
    "expect": { "error": "locked" } }
] }
\`\`\`

\`expect.output\` matches as a subset unless \`"match": "equals"\`. \`expect.error\` passes when the thrown message contains the text. \`mocks\` replace a provider with just the listed methods (\`{ "returns": value }\` or \`{ "throws": "message" }\`); any method not listed is missing.

**Saved requests**: \`workflows/<path>/<workflow>.requests.json\`, next to the \`.workflow\` file:

\`\`\`json
{ "lorien": 1, "requests": [
  { "id": "create-booking", "name": "books a free slot", "method": "POST", "path": "/bookings",
    "body": { "kind": "json", "json": { "roomId": 1, "from": "2030-01-01T10:00:00Z", "to": "2030-01-01T11:00:00Z" } },
    "expect": [ { "target": "status", "op": "equals", "value": 201 },
                { "target": "body", "path": "id", "op": "exists" },
                { "target": "node", "node": "Insert", "op": "exists" } ],
    "capture": { "bookingId": "body.id" } },
  { "id": "db-locked", "name": "answers 500 when the insert fails", "method": "POST", "path": "/bookings",
    "body": { "kind": "json", "json": { "roomId": 1, "from": "2030-01-02T10:00:00Z", "to": "2030-01-02T11:00:00Z" } },
    "mocks": { "Insert": { "error": "database is locked" } },
    "expect": [ { "target": "status", "op": "equals", "value": 500 } ] }
] }
\`\`\`

Checks: \`target\` is \`status\`, \`header\`, \`body\`, \`duration\` or \`node\` (a node's \`input\`, \`output\` or \`error\` by \`path\`; \`exists\`/\`notExists\` for whether it ran); \`op\` is \`equals\`, \`notEquals\`, \`contains\`, \`exists\`, \`notExists\`, \`matches\`, \`lessThan\`, \`greaterThan\` or \`type\`. \`path\` reads \`a.b\`, \`items[0].id\` or \`headers["x-id"]\`. \`mocks\` replace a node's output (\`{ "output": {...} }\`) or make it throw (\`{ "error": "..." }\`); naming a node the workflow doesn't have is an error. \`{{name}}\` in the request reads variables from \`lorien.environments.json\` (\`lorien.environments.local.json\` overrides it and stays out of git), from earlier captures, or the built-ins \`$uuid\`, \`$timestamp\`, \`$isoTimestamp\`, \`$randomInt\`. Requests run in order against the dev database, so a request that changes data should create what it changes.

\`npx lorien test\` flags: \`--env <name>\`, \`--base-url <url>\` to hit a running server (e.g. the built one), \`--no-nodes\`, \`--no-requests\`, \`--json\`, and an optional name filter.

**Vitest**, for checks JSON can't express: \`testWorkflow(workflow, { request, nodes, services })\` returns \`{ status, body, headers }\`; \`traceWorkflow\` also records each node (\`trace.at("FindRoom").output\`). Load the pieces with \`parseWorkflowFromString(await readFile(".../x.workflow", "utf-8"))\` and \`(await importNodes(root)).nodes\` from \`@darrylondil/lorien-runtime\`; the helpers come from \`@darrylondil/lorien-runtime/testing\`. Put these tests in \`workflows/**/*.test.ts\`. The scaffolded \`vitest.config.ts\` inlines the runtime so node files load; keep it.

## Renaming and moving

The IDE's rename updates everything. By hand:
- **A node file**: update every \`"uses"\` that points at it, and move its \`.cases.json\` with it.
- **A node id in a workflow**: update the \`in\` and \`when\` references and \`after\` lists that name it, plus \`mocks\` and \`node\` checks in the workflow's \`.requests.json\`.
- **A workflow file**: the route stays \`values.path\`; move its \`.requests.json\` with it.

## Verification

After edits, run:

\`\`\`
npm run typecheck && npm run test && npm run build
\`\`\`

\`lorien build\` checks workflow structure (references to unknown nodes, cycles, unknown keys, duplicate routes). It doesn't check that a referenced output field exists or that an \`in\` key matches the node's inputs: the tests do. Give every route at least one saved request.

## What you should NOT do

- Don't hand-edit anything under \`.lorien/\` (IDE cache, generated types and chat transcripts).
- Don't introduce an edges-array workflow format. lorien is named-input style: each node declares its own inputs.
- Don't put business logic or error handling in middleware; that's nodes and \`when\`.
- Don't read \`process.env\` in nodes; declare env vars on a provider.
- \`@darrylondil/lorien-runtime\` and \`@darrylondil/lorien-build\` stay devDependencies: \`src/server.ts\` and \`defineNode\` use the runtime while developing, and the built \`dist/index.js\` bundles what it needs.
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
      test: "lorien test && vitest run --passWithNoTests",
      typecheck: "lorien types && tsc --noEmit",
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

/**
 * Vitest runs the runtime from node_modules, where it would load node files
 * with Node's own import() and miss `./x.js` → `./x.ts`. Inlining the runtime
 * lets Vite load them, the same way it loads the tests.
 */
export function renderVitestConfig(): string {
  return `import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    server: { deps: { inline: [/@darrylondil\\/lorien-runtime/] } },
  },
})
`
}

/** Node cases for say-hello, run by \`lorien test\` and the IDE's Tests tab. */
export function renderSayHelloCases(): string {
  const cases = {
    lorien: 1,
    cases: [
      {
        id: "greets",
        name: "greets",
        input: {},
        expect: { output: { greeting: "Hello from lorien!" } },
      },
    ],
  }
  return `${JSON.stringify(cases, null, 2)}\n`
}

/** A saved request for GET /hello, run by \`lorien test\` and the IDE's Run tab. */
export function renderHelloRequests(): string {
  const requests = {
    lorien: 1,
    requests: [
      {
        id: "hello",
        name: "says hello",
        method: "GET",
        path: "/hello",
        expect: [
          { target: "status", op: "equals", value: 200 },
          { target: "body", op: "equals", value: "Hello from lorien!" },
        ],
      },
    ],
  }
  return `${JSON.stringify(requests, null, 2)}\n`
}

export function renderLorienConfig(): string {
  return `import { defineConfig } from "@darrylondil/lorien-runtime"

// Databases, loggers and clients go in providers/, one defineProvider each.
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
    return { greeting: "Hello from lorien!" }
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
  console.log(\`lorien listening on http://localhost:\${port}\`)
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
    "description: Use when authoring or editing files in a lorien project — workflows (.workflow JSON dependency graphs), nodes (typed defineNode modules), providers (defineProvider dependencies like a db or logger), middleware (workflows/**/_middleware.ts), or their tests (*.cases.json, *.requests.json). Triggers on edits in workflows/, nodes/, providers/, or any file ending in .workflow.",
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

API project built with [lorien](https://github.com/darrylhuffman/lorien).

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
# "Hello from lorien!"
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
