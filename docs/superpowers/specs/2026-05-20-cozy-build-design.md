# `@cozy/build` — design supplement

**Date:** 2026-05-20
**Builds on:** `2026-05-20-cozy-api-design.md` §3.9 (production build)
**Scope:** Plan #2 — the `cozy` CLI binary and its build/dev/init commands.
**Status:** design approved, ready for plan-writing

---

## Why this supplement

The original spec covered `cozy build` semantically (target Hono, idiomatic TS, zero `@cozy/runtime` at runtime) but left several implementation choices open. This document captures those choices for Plan #2 implementation.

## What's in Plan #2

The `@cozy/build` package shipping these commands:

- **`cozy build`** — codegen all `.workflow` files into `dist/`. Emitted code has no `@cozy/runtime` runtime; only `hono` and the user's node modules. Passes `tsc --noEmit` against the user's tsconfig.
- **`cozy dev`** — thin wrapper that spawns `tsx src/server.ts` in the user's project. Generates `.cozy/types/services.d.ts` first.
- **`cozy init`** — writes/updates `AGENTS.md` into an existing project. Used when a user adopts cozy-api in a project that wasn't scaffolded via `create-cozy-api`.
- **`cozy import-openapi <spec>`** — STUB only in Plan #2. Prints "OpenAPI import lands in Plan #3 (`@cozy/openapi`)." The real generator is in Plan #3.

## What's NOT in Plan #2

- Hot reload during `cozy dev` (v1.1)
- Static schema extraction via TypeScript Compiler API (Plan #4+, for the IDE)
- Watch mode on `cozy build` (v1.1)
- Multiple build targets beyond Hono (v2+)
- The actual OpenAPI generator (Plan #3)

## Design choices

### CLI library

**`commander` v12+.** Subcommand dispatch, type-safe argument parsing, well-documented `--help` output. Small dep footprint.

Alternative considered: `node:util/parseArgs` (zero-dep). Rejected — the subcommand UX is verbose to implement by hand.

### Schema extraction approach

**Dynamic-import-then-introspect.** Reuses the existing `importNodes` from `@cozy/runtime`. At build time we have Node.js available (we're inside a build script), so we can import each node module, read its `.inputs`/`.outputs` Zod schemas as runtime objects, and convert them to whatever representation we need.

Alternative considered: TS Compiler API static parsing. Rejected for Plan #2 because:
- Dynamic import already works (proved in Plan #1.5)
- Static parsing requires significant infrastructure (program creation, AST walking, type resolution)
- The IDE will need static parsing eventually (for type-checking unsaved buffers), but that's a separate sub-project

### Codegen output structure

For each workflow at `workflows/<path>.workflow`, emit `dist/workflows/<path>.gen.ts`. Plus a top-level `dist/index.ts` that imports all generated files and registers them on a Hono app.

Example: `workflows/users/create.workflow` produces `dist/workflows/users/create.gen.ts` exporting `function register(app: Hono)`.

`dist/index.ts` looks like:

```ts
import { Hono } from "hono"
import { serve } from "@hono/node-server"
import { register as registerUsersCreate } from "./workflows/users/create.gen.js"

const app = new Hono()
registerUsersCreate(app)

const port = Number(process.env.PORT) || 3000
serve({ fetch: app.fetch, port })
```

Each `.gen.ts` file is self-contained: imports its node modules directly, inlines config values, uses `Promise.allSettled` for parallel waves (matching the runtime's semantics).

### Services type generation

`@cozy/build` includes a side-effect step that:

1. Dynamic-imports `cozy.config.ts`
2. Inspects `default.services` — for each key, infers a TypeScript type from the value (singleton: the value's type; factory: the return type of the factory)
3. Generates `.cozy/types/services.d.ts` with a `declare module "@cozy/runtime" { interface Services { ... } }` block
4. Suggests adding the file to `tsconfig.json` `include` (or just relies on `types` discovery)

The user's nodes that destructure `services.db` then have proper types.

In v1.0 we use a simplified type inference: just `unknown` for each service value, with a comment that users can manually refine. Proper type inference from the value's TypeScript type (using the TS compiler) is v1.1.

### Hot reload deferral

`cozy dev` v1.0 is `spawn("tsx", ["src/server.ts"], { stdio: "inherit", cwd: projectRoot })`. If the user edits files, they restart the dev server themselves (or wrap `tsx` with `tsx watch` which has its own watch mode).

v1.1 will add proper integration with file-watching to restart on changes to workflows, nodes, or `cozy.config.ts`.

### CLI ergonomics

```
$ cozy --help
Usage: cozy <command> [options]

Commands:
  build [options]                  Generate dist/ from workflows/ and nodes/
  dev [options]                    Start the dev server (tsx src/server.ts)
  init                             Add AGENTS.md to the current project
  import-openapi <spec>            (Plan #3) Generate client nodes from an OpenAPI spec
  --help                           Show help
  --version                        Show version

Run "cozy <command> --help" for more info on a command.
```

```
$ cozy build --help
Usage: cozy build [options]

Generate dist/ from your cozy-api project.

Options:
  --root <path>     Project root (default: process.cwd())
  --outDir <path>   Output directory (default: ./dist)
  --skip-types      Skip services type generation
  --help            Show this help
```

```
$ cozy dev --help
Usage: cozy dev [options]

Start the dev server. Currently a thin wrapper around `tsx src/server.ts`.

Options:
  --root <path>     Project root (default: process.cwd())
  --help            Show this help
```

## Equivalence harness

The acceptance criterion for `cozy build` is that the generated code produces the same response as the interpreter for the same workflow + input.

Implementation: a Vitest test in `packages/build/` that:
1. Loads the `examples/basic-api` workspace
2. For a curated set of (workflow, request) pairs:
   - Runs the workflow via `testWorkflow` (interpreter) → captures response
   - Runs `cozy build` on the workspace → loads the generated `dist/index.ts` → fires the same request via Hono's `app.request(...)` → captures response
   - Asserts the two responses are deep-equal

This protects against silent dev/prod divergence as the codegen evolves.

## Plan #2 task structure

1. `@cozy/build` package scaffold
2. CLI dispatcher (commander, subcommand registration, --help, --version)
3. `cozy dev` command (spawn tsx)
4. `cozy init` command (write/update AGENTS.md)
5. Schema extractor (importNodes-based, returns per-node schemas)
6. Services type generator (.cozy/types/services.d.ts)
7. Codegen: topology + parallel grouping
8. Codegen: workflow → register(app) emitter
9. Codegen: dist/index.ts master emitter
10. `cozy build` command (orchestrate)
11. `cozy import-openapi` stub
12. Equivalence harness test
13. Update basic-api example to use `cozy build` for production output

After Task 13, the basic-api example can produce `dist/` and run from `node dist/index.js` with zero `@cozy/runtime` runtime dependency.

## Acceptance for Plan #2

A user can:

1. In any cozy-api project, run `cozy build` and get a working `dist/` of plain TS Hono routes
2. Delete `@cozy/runtime` from production dependencies; `dist/` still runs
3. Run `cozy dev` from any cozy-api project to start the dev server
4. Run `cozy init` in an existing project to get AGENTS.md
5. Run `cozy import-openapi spec.json` and see a stub message pointing to Plan #3
6. Equivalence harness passes — `testWorkflow` and `cozy build`-emitted code agree on response output

Plan #3 (`@cozy/openapi`) then implements the real `import-openapi` behavior.
