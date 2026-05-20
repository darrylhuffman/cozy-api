# cozy-api DX layer — design

**Date:** 2026-05-20
**Builds on:** `2026-05-20-cozy-api-design.md` (sub-project #1 spec)
**Scope:** Plan #1.5 (`startCozyServer` in `@cozy/runtime`) + Plan #2.5 (`create-cozy-api` scaffolder)
**Status:** design approved, ready for plan-writing

---

## 1. Why

After Plan #1, a user can build a cozy-api project — but only by hand-wiring `loadWorkspace` + `mountWorkflows` + service resolution, listing every node module manually in the resolver map. That's friction. Next.js-style file-based routing is the right model: drop a `.workflow` into `workflows/` and a `.ts` into `nodes/`, and it Just Works.

The two pieces:

- **`startCozyServer`** lives in `@cozy/runtime`. Walks `workflows/` and `nodes/` from a project root, dynamic-imports every node, auto-loads `cozy.config.ts`, mounts everything on a Hono app, returns it.
- **`create-cozy-api`** is a separate standalone npm package. `npx create-cozy-api my-app` generates a complete starter project (deps, configs, sample workflow + node, server entry, AGENTS.md, README), detects the calling package manager, runs install, prints next steps.

Together: a user goes from `npx create-cozy-api my-app` → editing one workflow → `pnpm dev` and seeing `GET /hello` respond, all in under a minute.

---

## 2. `startCozyServer` design

### 2.1 API

```ts
export async function startCozyServer(opts?: StartServerOptions): Promise<Hono>

export interface StartServerOptions {
  /** Project root. Defaults to process.cwd(). */
  root?: string
  /** Service overrides on top of cozy.config.ts. Useful for tests. */
  services?: Partial<Services>
  /** Node overrides on top of disk-discovered nodes. Useful for tests. */
  nodes?: Record<string, AnyNodeOrTrigger>
  /** Optional lifecycle subscriber. */
  lifecycle?: LifecycleEmitter
  /** Default true; if false, parse errors throw instead of being logged. */
  lenient?: boolean
}
```

**Returns the Hono app.** The caller is responsible for starting the server with their preferred adapter (`@hono/node-server`, Bun's `Bun.serve`, Deno, edge runtimes). This is intentional — no lock-in to any specific runtime.

### 2.2 Auto-discovery rules

Given `root`:

1. **`cozy.config.ts`** at `root` — dynamic-imported. Its default export's `services` field provides the service registry. Missing config = empty services (warn, don't throw).
2. **`workflows/**/*.workflow`** — every file walked, parsed via `parseWorkflowFromString`. Invalid files logged but skipped (lenient mode); strict mode throws.
3. **`nodes/**/*.ts`** — every file walked, dynamic-imported. The default export is captured. The import path is the project-relative path with `.ts` extension dropped: `nodes/foo/bar.ts` → `uses` key `"./nodes/foo/bar"`. Files with parse errors or missing default exports logged + skipped.

Existing `loadWorkspace` returns a node registry that's still empty (Plan #1 deferred node loading). `startCozyServer` does the dynamic-import legwork and populates the registry.

### 2.3 Test ergonomics

Overrides win. If `opts.nodes` provides a key, it shadows the disk version. Same for `opts.services`.

```ts
// Real dev: zero-config
const app = await startCozyServer()

// Test: override a node and a service
const app = await startCozyServer({
  root: __dirname,
  nodes: { "./nodes/save-user": mockSaveUser },
  services: { db: mockDb },
})
```

`testWorkflow` / `traceWorkflow` keep their existing signature (they receive a workflow and a service/node map, no root). Auto-discovery is opt-in via `startCozyServer`.

### 2.4 Runtime requirements

Dynamic-importing `.ts` files requires either:
- The project is run via `tsx src/server.ts` (loader hook handles TS)
- Or Bun (native TS)
- Or after `cozy build` (Plan #2), the imported files are emitted JS

In pure Node without a TS loader, `startCozyServer` cannot import `.ts` nodes. The function detects this and throws with a clear error pointing to the `tsx` or `cozy build` path.

### 2.5 Error handling

- Missing `cozy.config.ts`: warn, continue with empty services
- `workflows/` directory absent: warn, continue (no routes will be mounted)
- `nodes/` directory absent: warn, continue (workflows referencing nodes will fail validation)
- Individual file parse errors: log to stderr, skip the file (lenient: true). With `lenient: false`, throw on the first error
- Validation errors per workflow: log them, skip mounting that workflow's routes

---

## 3. `create-cozy-api` design

### 3.1 Package structure

Standalone npm package `create-cozy-api`, published to npm independently. NOT part of the monorepo packages, but lives in the monorepo for development: `packages/create-cozy-api/`. Has its own `package.json` with a single binary entry: `create-cozy-api`.

```json
{
  "name": "create-cozy-api",
  "version": "0.0.0",
  "bin": { "create-cozy-api": "./dist/cli.js" },
  ...
}
```

### 3.2 CLI behavior

```
$ npx create-cozy-api my-app
```

1. **Argument:** the target directory name (positional). Must be a valid npm package name. If absent, prompt for it (interactive).
2. **Directory check:** if `./my-app` exists and is non-empty, refuse and exit with a clear error (no `--force` flag in v1).
3. **Package manager detection:**
   - `process.env.npm_config_user_agent` indicates which manager invoked the command
   - Maps to `pnpm`, `npm`, `yarn`, or `bun`
   - Fallback: `npm`
4. **Generate files** (see §3.3).
5. **Install** by running the detected manager's install command in the new directory.
6. **Print next steps** with copy-paste commands.

### 3.3 Scaffolded files

```
my-app/
├── .gitignore                    # node_modules, dist, .cozy, .env, etc.
├── package.json                  # @cozy/runtime devDep, hono + zod deps, scripts
├── tsconfig.json                 # extends "@cozy/runtime/tsconfig" or inlined strict config
├── biome.json                    # matches project conventions
├── cozy.config.ts                # defineConfig with empty services + target: "hono"
├── workflows/
│   └── hello.workflow            # GET /hello -> sayHello -> response
├── nodes/
│   └── say-hello.ts              # defineNode returning { greeting: "Hello, world!" }
├── src/
│   └── server.ts                 # startCozyServer + @hono/node-server adapter
├── AGENTS.md                     # AI agent skill artifact (static for v1)
└── README.md                     # quickstart instructions
```

### 3.4 Sample workflow content

`workflows/hello.workflow`:

```json
{
  "cozy": 1,
  "nodes": {
    "request": {
      "uses": "@core/http-request",
      "config": { "path": "/hello", "method": "GET" }
    },
    "say": {
      "uses": "./nodes/say-hello",
      "in": {}
    },
    "response": {
      "uses": "@core/response",
      "in": { "body": "say.greeting" }
    }
  }
}
```

`nodes/say-hello.ts`:

```ts
import { defineNode } from "@cozy/runtime"
import { z } from "zod"

export default defineNode({
  name: "Say Hello",
  inputs: z.object({}),
  outputs: z.object({ greeting: z.string() }),
  async run() {
    return { greeting: "Hello from cozy-api!" }
  },
})
```

`src/server.ts`:

```ts
import { serve } from "@hono/node-server"
import { startCozyServer } from "@cozy/runtime"

const app = await startCozyServer()
serve({ fetch: app.fetch, port: 3000 }, ({ port }) => {
  console.log(`cozy-api listening on http://localhost:${port}`)
})
```

`AGENTS.md` (placeholder for the eventually-richer artifact in Plan #2):

```markdown
# cozy-api project guide for AI agents

This project uses cozy-api: file-based API routing where `.workflow` files
define HTTP endpoints as dependency graphs of typed nodes.

## Layout
- `workflows/**/*.workflow` — HTTP routes as JSON dependency graphs
- `nodes/**/*.ts` — typed compute units (via `defineNode` from `@cozy/runtime`)
- `cozy.config.ts` — services (db, logger, etc.)

## Node contract
[brief]

## Workflow file format
[brief]

(Full guide will be written by `cozy init` in plan #2.)
```

`README.md`:

```markdown
# {{name}}

API project built with cozy-api.

## Quickstart

\`\`\`
{{pm}} dev       # start dev server
{{pm}} test      # run tests (vitest)
\`\`\`

Then `curl http://localhost:3000/hello` returns `{"greeting":"Hello from cozy-api!"}`.

## Layout

- `workflows/` — HTTP routes as `.workflow` JSON files
- `nodes/` — typed compute units (`defineNode` modules)
- `cozy.config.ts` — service registry

See AGENTS.md for the full author's guide.
```

`package.json`:

```json
{
  "name": "{{name}}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "hono": "^4.12.21",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@cozy/runtime": "latest",
    "@types/node": "^25.9.1",
    "tsx": "^4.20.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.7"
  }
}
```

(Versions are queried via `npm view <pkg> version` at scaffold time so they're always fresh. Falls back to baked-in versions if offline.)

### 3.5 Next-steps output

After successful generation + install:

```
✓ Created my-app with cozy-api

Next steps:
  cd my-app
  pnpm dev               # start dev server on port 3000
  curl localhost:3000/hello

To add a new route:
  Create workflows/<name>.workflow and any nodes you need under nodes/.

To run tests:
  pnpm test

Eventual IDE (coming soon):
  pnpm cozy ide          # not yet implemented

Documentation: https://cozy-api.dev (placeholder)
```

The "Eventual IDE" line previews the upcoming work without overpromising.

---

## 4. Decisions log

- `startCozyServer` returns the Hono app; user serves it themselves
- Test path keeps `testWorkflow`/`traceWorkflow` with explicit node/service maps (no auto-discovery in tests by default)
- Dynamic imports require `tsx` (or Bun, or post-`cozy build`)
- Lenient error handling by default; strict mode opt-in
- Scaffolder auto-installs via detected package manager
- Sample is "GET /hello returning JSON" — minimum viable
- Scaffolder lives in `packages/create-cozy-api/` in the monorepo

---

## 5. Acceptance criteria for these two plans

A new user can, in one shell session:

1. `pnpm dlx create-cozy-api my-app` (or `npx`, `bunx`, etc.)
2. `cd my-app && pnpm dev`
3. `curl http://localhost:3000/hello` returns `{"greeting":"Hello from cozy-api!"}`
4. Edit `workflows/hello.workflow` to add a new route, save, hit it. (Hot-reload deferred to v1.x.)
5. Add a new node in `nodes/foo.ts`, reference it from a workflow, hit the workflow, see it work.
6. Write a `vitest` test against the workflow using `testWorkflow`/`traceWorkflow`. Tests pass.

No manual wiring of `loadWorkspace` + `mountWorkflows`. No mention of services unless the user explicitly adds them.
