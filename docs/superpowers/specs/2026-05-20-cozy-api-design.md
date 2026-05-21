# lorien-api — design

**Date:** 2026-05-20
**Working name:** `lorien-api` (file extension `.workflow` is brand-neutral)
**Status:** brainstorm complete, ready for implementation planning of sub-project #1

---

## 1. Vision

lorien-api is an in-browser IDE for building HTTP APIs through a typed, drag-and-drop graph editor. It produces idiomatic TypeScript at build time, so deployed APIs have **zero dependency on lorien-api itself**. The IDE supports both human-driven and AI-driven authoring; the workflow file format is optimized for hand-editing.

### Pillars

- **Two execution paths, one model.** A dev-time interpreter executes `.workflow` files for rich debugging and live values. A prod-time codegen emits plain TypeScript that calls the same node modules directly. The two share one execution semantics by construction — codegen is "inline what the interpreter would do."
- **Types are the source of truth.** Nodes declare inputs/outputs as Zod schemas. The editor reads schemas to render ports; validation, type inference, and form UI all derive from the same source.
- **Files are human-editable.** The `.workflow` format is named-input style: each node's block describes where its inputs come from. No separate edges list. AIs and humans can hand-author files without the IDE.
- **AI-as-skill, not AI-as-feature.** v1 ships no in-editor AI. It ships a documentation artifact at a known location that any agent (Claude, Cursor, Copilot) can read to understand lorien-api's conventions and author files correctly.

### v1 scope (this design covers)

A user can:
- Create workflows (HTTP routes) and nodes (compute units) in a browser IDE
- Wire nodes by dragging from output ports to input ports, with field-level mapping
- Run workflows in-IDE with live values, breakpoints, step controls, replay
- Write tests against workflows and nodes (Vitest)
- Build for production — `lorien build` emits Hono route code with no lorien-api runtime
- Import an OpenAPI JSON spec → generated client nodes appear under `nodes/<api>/`
- Drop a documentation file into their repo so AI assistants can author lorien-api content

### Out of scope for v1

- Streaming / per-element fan-out outputs
- Cancellation tokens, retry-as-runtime-feature
- Custom triggers beyond HTTP (scheduled, event triggers — v2)
- Languages other than TypeScript (TS only)
- OpenAPI-to-workflow scaffolding (only OpenAPI-to-client-nodes — v2)
- In-editor AI generation features (only the AI skill artifact — v2)
- Real-time collaborative editing
- Hosted runtime (users deploy the emitted code themselves)
- Multiple output framework targets (Hono only; Fastify/Express adapters v2)

---

## 2. Subsystem decomposition

lorien-api is ten subsystems. Each has its own spec → plan → implementation cycle. This design specs **sub-project #1** in depth and captures **validated direction** for the rest.

| # | Subsystem | Status in this design | Depends on |
|---|---|---|---|
| 1 | Workflow format & runtime engine (headless) | **specced below** | nothing |
| 2 | Type-from-code inference | **specced below** (within #1) | 1 |
| 3 | IDE shell (panes, tabs, file tree) | direction validated | nothing |
| 4 | Visual graph editor | direction validated | 1, 2, 3 |
| 5 | Code editor pane (Monaco + TS LSP) | direction validated | 3 |
| 6 | DI / services layer | **specced below** | 1 |
| 7 | Debugger (breakpoints, step, replay) | **specced below** | 1, 4 |
| 8 | OpenAPI client-node import | **specced below** | 1 |
| 9 | Workflow test runner | **specced below** | 1 |
| 10 | Production compiler | **specced below** | 1 |

The IDE-facing subsystems (3, 4, 5) are next after #1 ships. Their UI direction is captured in §7.

---

## 3. Sub-project #1: workflow format & runtime engine

This is the headless foundation. Everything else consumes its data model and runtime semantics. Shipping this first means we can run real workflows end-to-end (via tests) before any IDE pixel exists.

### 3.1 The `.workflow` file format

Named-input JSON. Each node lists where its inputs come from inline. No separate edges list. View metadata is segregated from semantic graph.

```jsonc
{
  "lorien": 1,
  "nodes": {
    "request": {
      "uses": "@core/http-request",
      "config": { "path": "/users", "method": "POST" }
    },
    "parseBody": {
      "uses": "./nodes/parse-body",
      "in": { "raw": "request.body" }
    },
    "validateEmail": {
      "uses": "./nodes/validate-email",
      "in": { "email": "parseBody.email" }
    },
    "hashPassword": {
      "uses": "./nodes/hash-password",
      "in": { "plain": "parseBody.password" }
    },
    "saveUser": {
      "uses": "./nodes/save-user",
      "in": {
        "email": "validateEmail.normalized",
        "passwordHash": "hashPassword.hash"
      }
    },
    "response": {
      "uses": "@core/response",
      "in": { "status": 201, "body": "saveUser.user" }
    }
  },
  "view": {
    "request":       { "x": 100, "y": 200 },
    "parseBody":     { "x": 320, "y": 200 },
    "validateEmail": { "x": 540, "y": 120 },
    "hashPassword":  { "x": 540, "y": 280 },
    "saveUser":      { "x": 760, "y": 200 },
    "response":      { "x": 980, "y": 200 }
  }
}
```

**Field semantics:**

- `lorien`: format version integer. v1 is `1`. Used for forward-compatible migrations.
- `nodes`: object keyed by **instance id**. The id is a valid JavaScript identifier; it's how other nodes reference this one. Two instances of the same module have different ids.
- `nodes.<id>.uses`: a module reference. Two forms:
  - `./<relative path>` — a user-authored node file, resolved relative to the workspace root's `nodes/` directory (or wherever the user organizes node files).
  - `@core/<name>` — a built-in node provided by the runtime. v1 built-ins: `@core/http-request`, `@core/response`. Other `@core/*` and custom `@<scope>/*` namespaces are reserved.
- `nodes.<id>.in`: an object mapping the node's input port names to either:
  - **A reference string** matching `^[a-zA-Z_$][\w$]*(?:\.[\w$]+)*$`. The first segment must be an instance id present in `nodes`; the rest is the dotted path into that node's outputs schema. If the first segment doesn't resolve to a known node, the parser reports a validation error (not a fallback to literal).
  - **A literal value** — any JSON value that doesn't match the reference regex. Numbers, booleans, arrays, objects, and strings containing characters outside identifier-and-dot syntax (spaces, hyphens, quotes, etc.) are literals.
  - **An explicit literal escape** for the rare case where you need a string literal that matches the reference regex (e.g., a field whose value is the literal text `"parseBody"`): wrap it as `{ "$literal": "parseBody" }`. The runtime strips the wrapper.
- `nodes.<id>.config`: per-instance configuration, an object whose shape is defined by the node's `config` Zod schema. Inlined into emitted code at build time.
- `nodes.<id>.after`: optional array of instance ids. Pure ordering constraint without a data wire — see §3.5.
- `view`: position metadata, keyed by instance id. Non-semantic; the runtime ignores it. Editor manages it.

**The `$request` magic identifier is gone.** Triggers are real nodes with `@core/*` paths; the request's data is accessed via the trigger node's outputs (e.g., `request.body`, `request.params.id`).

**References resolve at design time and at runtime.** The interpreter checks reference validity at load (does the target id exist? does the path exist in its outputs schema?) and reports errors before running. The build-time codegen does the same.

**No null in references.** A reference must resolve. Optional fields are modeled with `z.optional()` in the schema, not by leaving a reference dangling.

### 3.2 Node contract — `defineNode`

User-authored nodes export a single default `defineNode(...)` call. The helper is a generic identity wrapper that flows Zod-inferred types into the `run` function's argument types.

```ts
// nodes/hash-password.ts
import { z } from "zod"
import { defineNode } from "@darrylondil/lorien-runtime"

export default defineNode({
  name: "Hash Password",
  inputs: z.object({ plain: z.string() }),
  outputs: z.object({ hash: z.string() }),
  async run({ plain }, { logger }) {
    logger.info("hashing")
    return { hash: await bcrypt.hash(plain, 10) }
  }
})
```

**Fields:**

- `name?: string` — friendly display name. Optional; if omitted, the editor derives it by title-casing the filename. Module-level metadata; purely cosmetic; runtime ignores it.
- `inputs: ZodObject` — must be a `z.object({...})`. Each top-level key is an input port. Nested objects become expandable port trees in the editor.
- `outputs: ZodObject` — same constraint, same treatment.
- `config?: ZodObject` — optional per-instance configuration. Defines the form rendered on the node body. See §3.6.
- `run(input, services, config?)`: async function. Receives the resolved input, the typed services bag, and the resolved config. Returns a value matching the outputs schema.

**`defineNode` is compile-time-erased.** At build, codegen emits the function body inline; no `@lorien/runtime` import survives. In dev, the helper is an identity function. Zero runtime cost.

**Programmatic invocation.** `defineNode` returns a Node object whose `.run()` is directly callable. Other code (other nodes, tests, scripts) can `import hashPassword from "./hash-password"` and call `hashPassword.run({ plain }, services)`. Nodes are reusable utilities — the graph is one way to invoke them, plain TS is another.

**`defineTrigger`** is a parallel helper for entry-point nodes (built-ins in v1 only). Same shape minus `inputs` and `run`; the runtime fulfills outputs at workflow start from the trigger's source (HTTP request, etc.).

### 3.3 Type inference and port extraction

The IDE's node-file watcher parses each TS file (via the TS compiler, programmatic API) and looks for a `defineNode({...})` or `defineTrigger({...})` default export. It extracts:

- `name` (literal string or default-from-filename)
- `inputs` Zod schema → port tree
- `outputs` Zod schema → port tree
- `config` Zod schema → form spec

Extraction failures (no defineNode call, malformed schema, schema isn't a `z.object`) report as validation errors against the file. The node is shown in the tree with a warning indicator and can't be added to workflows until resolved.

Schemas are evaluated, not just statically inspected — the Zod schema is a runtime object, so we instantiate the module in a controlled context and read its exports. This is a known cost; we mitigate by caching per-file mtime.

### 3.4 DI / services

Services are declared in one file at workspace root:

```ts
// lorien.config.ts
import { defineConfig } from "@darrylondil/lorien-runtime"
import { createDb } from "./services/db"
import { createLogger } from "./services/logger"

export default defineConfig({
  target: "hono",                                          // §3.10
  services: {
    db: createDb(process.env.DATABASE_URL),                // singleton
    logger: (ctx) => createLogger(ctx.requestId),          // factory: per workflow run
  }
})
```

**Scoping:**

- A **value** registered under `services.<name>` is a singleton. Instantiated once at runtime boot; reused across all workflow runs.
- A **function** `(ctx: ServiceContext) => Service` is a per-run factory. Called once per workflow execution. `ctx` carries `{ requestId: string, timestamp: number }`.
- A service value may implement `dispose(): void | Promise<void>` for cleanup after a workflow run. The runtime awaits all `dispose()`s before completing the run.

**Type flow:**

The IDE generates an ambient declaration at workspace level:

```ts
// .lorien/types/services.d.ts (auto-generated, do not edit)
declare module "@darrylondil/lorien-runtime" {
  interface Services {
    db: import("./services/db").DBClient
    logger: import("./services/logger").Logger
  }
}
```

So when a node writes `async run(input, { db, logger }) { ... }`, TypeScript types `db` and `logger` correctly. Adding a service to `lorien.config.ts` causes regeneration of `services.d.ts`, and autocomplete picks it up in every node.

**Test overrides:** `testWorkflow(wf, { services: { db: mockDb } })` provides a partial override. Missing services fall back to the config.

### 3.5 Execution model

**Dataflow scheduler.** A node fires when every reference in its `in` block has resolved to a concrete value. Resolution comes from:
- Upstream node completion (its outputs are now populated), or
- Literal values (resolved immediately), or
- Trigger-supplied values (resolved at run start)

**Parallelism.** Multiple nodes can fire concurrently if their inputs are simultaneously ready. The scheduler runs them in `Promise.all`. Joins are implicit: a node waiting on N inputs simply doesn't fire until all N resolve.

**Side-effect ordering without data deps.** An `after: ["nodeA", "nodeB"]` field on a node adds an ordering constraint: the node won't fire until all listed nodes have completed, even if it has no data dependency on them. Escape hatch for log-before-send, rate limit gates, etc.

**Termination.** The workflow completes when the response node (the terminal `@core/response` for HTTP triggers) fires. Other unreachable-from-trigger or post-response nodes do not run.

**Input validation.** Before calling each node's `run()`, the runtime validates the resolved input bag against the node's `inputs` Zod schema. A validation failure throws `NodeRunError` with the failing path and message. This means nodes never have to manually `.parse()` their inputs — declaring the schema IS the validation.

**Error policy (v1.0):** fail-fast. If any node throws, the workflow halts. In-flight sibling nodes are awaited (so `dispose()`s run on services) but their results are discarded. The response becomes a 500 with a generic message. Custom error handler nodes (`error: "nodeId"` at the top level) are deferred to v1.x — not in v1.0.

**Multiple triggers per workflow.** `nodes` may contain multiple `@core/http-request` (or other trigger) nodes. Each defines an independent entry point. When a trigger fires, the scheduler walks forward only through nodes transitively reachable through ports from *that* trigger. Two triggers in the same file are independent at execution time even when they share intermediate nodes (each invocation instantiates its own port resolution state).

**Deferred to v2:** streaming outputs, per-element fan-out (a `map: true` edge attribute or `forEach` meta-node), cancellation tokens, retry-as-runtime-feature.

### 3.6 Per-node config + inline UI generation

A node's optional `config` Zod schema defines per-instance settings. The IDE auto-renders a form on the node body from the schema:

| Zod type | Widget |
|---|---|
| `z.string()` | text input |
| `z.string().describe(s)` | text input with placeholder `s` |
| `z.number()` | number input |
| `z.boolean()` | switch |
| `z.enum([...])` | dropdown |
| `z.object({...})` | nested fieldset |
| `z.array(z.string())` | tag input |
| Anything + `.meta({ widget: "textarea", rows: 4 })` | overridden widget |

**Defaults with token expansion.** `z.string().default("{workflow_path}")` pre-fills the form at node insertion. Tokens resolved at insertion time (so moving the file later doesn't surprise-rename anything):

- `{workflow_path}` — workflow's folder path, normalized to URL form
- `{workflow_name}` — workflow file's basename
- `{workflow_dir}` — workflow's directory

**Folder convention for path params:** `[id]` in folder/file names maps to `:id` in URLs. `workflows/users/[id]/get.workflow` → default path `/users/:id`.

**Config flows to `run` as a third arg:** `async run(input, services, config)`. At build, config values are inlined as object literals at the call site.

**For triggers**, config drives registration (HTTP route mount, etc.) at workflow load — not at run.

### 3.7 Debugger / breakpoints

The dev-time interpreter exposes lifecycle events over a websocket:

- `before-node` — about to call `run`. Carries `{ nodeId, input, services }`.
- `after-node` — `run` returned. Carries `{ nodeId, output, durationMs }`.
- `edge-fired` — a value flowed from one port to another. Carries `{ from, to, value }`.
- `error` — a node threw. Carries `{ nodeId, error }`.
- `complete` — workflow finished. Carries `{ status, body, totalMs }`.

**Breakpoint kinds:**
- **On a node** — pauses `before-node`. Input is visible.
- **On an output port** — pauses `after-node` for that node. Output is visible before downstream nodes trigger.
- **Inside node code** — handled by the standard JS host debugger via `debugger;` statements. The interpreter doesn't try to do line-level breakpoints.

**Breakpoint state is session-local.** Stored in workspace IDE state, not in `.workflow` files. Shareable workflows aren't polluted with personal debug state.

**Step controls:**
- **Continue** — resume until next breakpoint or completion
- **Step** — fire the next ready node, pause after
- **Step over node** — fire fully, skip breakpoints inside
- **Replay** — re-run the whole workflow with the same trigger input

**Production:** none of this ships. Lifecycle hooks, websocket bridge, breakpoint state — all dev-only. The emitted code is plain `await`s.

### 3.8 Workflow tests

Tests are plain TypeScript files next to their subject (no `tests/` folder duplication):

```
workflows/users/create.workflow
workflows/users/create.test.ts        ← tests for the workflow
nodes/hash-password.ts
nodes/hash-password.test.ts           ← tests for the node
```

**Two helpers from `@lorien/runtime/testing`:**

```ts
// End-to-end: returns the response
const res = await testWorkflow(createUser, {
  request: { body: { email: "a@b.com", password: "x" } },
  services: { db: mockDb }                                 // partial override
})
expect(res.status).toBe(201)

// Trace: returns a TraceResult you can inspect at any node
const trace = await traceWorkflow(createUser, { request: {...} })
expect(trace.at("hashPassword").output.hash).toMatch(/^\$2b\$/)
expect(trace.errors).toEqual([])
```

**Node-level tests** are plain TS — `import myNode from "./my-node"` and call `myNode.run(input, services)` directly.

**Runner:** Vitest. Works with both Bun and Node. The IDE shells out and parses results; no custom runner. Watch mode is the default.

### 3.9 Production build — `lorien build`

`lorien build` reads `lorien.config.ts`, every `.workflow` file, every referenced node module, and emits idiomatic TypeScript under `dist/` (or configurable). The emitted code has **no `@lorien/runtime` dependency** — `defineNode`/`defineTrigger` are erased, references become inlined function calls, config becomes object literals.

**v1 target: Hono.** Each workflow with HTTP triggers compiles to:

```ts
// dist/workflows/users/create.ts (generated)
import { Hono } from "hono"
import { db, logger } from "../../services"
import parseBody from "../../nodes/parse-body"
import validateEmail from "../../nodes/validate-email"
import hashPassword from "../../nodes/hash-password"
import saveUser from "../../nodes/save-user"

export default function register(app: Hono) {
  app.post("/users", async (c) => {
    const requestId = crypto.randomUUID()
    const services = { db, logger: logger({ requestId, timestamp: Date.now() }) }
    try {
      const request = { body: await c.req.json(), params: c.req.param(), /* ... */ }
      const _parseBody = await parseBody.run({ raw: request.body }, services)
      const [_validateEmail, _hashPassword] = await Promise.all([
        validateEmail.run({ email: _parseBody.email }, services),
        hashPassword.run({ plain: _parseBody.password }, services),
      ])
      const _saveUser = await saveUser.run({
        email: _validateEmail.normalized,
        passwordHash: _hashPassword.hash,
      }, services)
      return c.json(_saveUser.user, 201)
    } finally {
      await Promise.allSettled([services.logger.dispose?.(), /* ... */])
    }
  })
}
```

**Parallelism is preserved** via `Promise.all` on independent branches. Joins are sequential awaits. The emitted code reads like a competent human wrote it.

**A top-level `dist/index.ts`** wires up all `register(app)` calls and starts the Hono server.

**TypeScript:** emitted code passes `tsc --noEmit` against the project's tsconfig. No `any`, no `@ts-expect-error`. The emitted shape is fully typed end-to-end because we inline real type-bearing references.

**`lorien build --watch`** for development of the dist output (rare; the dev interpreter is usually preferred).

**Adapters for Fastify/Express** are deferred to v2. v1 is Hono-only.

### 3.10 OpenAPI client-node import

`lorien import-openapi <spec.json>` reads a JSON OpenAPI 3.x spec and generates one node per operation under `nodes/<api-slug>/`. Each generated node:

- Has `name` derived from the operation's `operationId` or `summary`
- Has `inputs` Zod schema derived from the operation's path params, query, headers, and body
- Has `outputs` Zod schema derived from the operation's 2xx response body
- Has a `run` that calls the external API via `fetch`
- Lives in a regular `.ts` file the user can edit (it's not magic — just generated TS)

**Re-importing** preserves user edits via a header comment marker. Generated regions are guarded; non-guarded regions are left alone. Conflicts (operation removed, schema changed incompatibly) are reported, not silently overwritten.

**XML/YAML specs are out of scope for v1** — parsing variations, not new capability. User can convert externally.

### 3.11 The AI agent skill artifact

lorien-api ships a markdown file at a known location in user repos (`AGENTS.md` at the repo root, plus `.lorien/AGENT-GUIDE.md` for the long-form reference). The file documents:

- The `.workflow` file format with examples
- The `defineNode` / `defineTrigger` contract
- The services pattern
- Folder conventions
- Common node patterns

The format is optimized for AI consumption — concise, explicit, example-heavy, no marketing prose. The file is generated/updated by the `lorien init` command and stays in sync with the runtime version via a header version stamp.

Any AI assistant (Claude Code, Cursor, Copilot Chat) can read this file as part of its context and author lorien-api artifacts correctly. We do not ship an in-IDE AI panel in v1.

---

## 4. v1 architecture summary

```
┌──────────────────────────────────────────────────────────────┐
│  User's workspace                                            │
│                                                              │
│  lorien.config.ts            services registry, target, etc.   │
│  workflows/                .workflow files (JSON)            │
│  nodes/                    defineNode TS files               │
│  AGENTS.md                 AI agent skill (generated)        │
│  .lorien/types/services.d.ts  generated ambient types          │
└──────────────────────────────────────────────────────────────┘
        │                                                │
        │ dev                                            │ build
        ▼                                                ▼
┌────────────────────────┐                ┌──────────────────────────┐
│ @lorien/runtime           │                │ @lorien/build               │
│ Interpreter (dataflow)  │                │ Codegen → dist/*.ts       │
│ Lifecycle events ws     │                │ Erases defineNode helper  │
│ Test helpers            │                │ Inlines config            │
│ Service resolution      │                │ Emits Hono routes         │
└────────────────────────┘                └──────────────────────────┘
        │                                                │
        ▼                                                ▼
   IDE / Vitest                                  Deployed API
                                            (no lorien-api at runtime)
```

---

## 5. Package layout (proposed)

A monorepo with these packages:

- `@lorien/runtime` — `defineNode`, `defineTrigger`, `defineConfig`, lifecycle types, interpreter (dev-only), testing helpers
- `@lorien/build` — `lorien build` CLI, codegen, Hono adapter, type generation
- `@lorien/openapi` — `lorien import-openapi` command, OpenAPI → node generator
- `@lorien/ide` — the browser IDE (later sub-projects)
- `@lorien/ide-server` — local dev server that powers the IDE (later sub-projects)

The first three constitute sub-project #1's deliverable.

---

## 6. Test plan for sub-project #1 (headless)

Because sub-project #1 ships headless, its full value is provable via tests:

1. **Parser tests** — `.workflow` files parse correctly; invalid forms produce useful errors.
2. **Reference resolution tests** — dotted paths resolve to the right port values; cycles are rejected; missing references are rejected.
3. **Scheduler tests** — dataflow order is correct under simple, parallel, join, and `after` cases.
4. **DI tests** — singletons are reused, factories are called once per run, `dispose()` is awaited, type generation produces a valid `.d.ts`.
5. **Interpreter integration tests** — end-to-end workflows execute and produce expected outputs.
6. **Error policy tests** — fail-fast semantics, sibling cleanup.
7. **Codegen tests** — emitted code is valid TS, passes `tsc --noEmit`, runs and produces identical results to the interpreter, has zero `@lorien/*` imports at runtime.
8. **Equivalence harness** — a property-based check: for a random workflow + input, the interpreter and the emitted code produce the same response.

The equivalence harness is the strongest single safeguard against dev/prod drift.

---

## 7. Validated UI direction for later sub-projects

These were settled during the brainstorm but are not part of sub-project #1's implementation. Captured here so context isn't lost when subsystems #3–#5 are specced.

### 7.1 IDE shell (Layout B)

Three-column always-on layout:

```
┌──────────┬────────────────────┬──────────────┐
│ Workflows│                    │ Inspect      │
│ (tree)   │   Canvas / Code    │ Tests        │
│          │   tabs share area  │ Run          │
│ Nodes    │                    │              │
│ (tree)   │                    │              │
└──────────┴────────────────────┴──────────────┘
```

Panels are dockable/movable (defer customization to v2); the default is the three-column split. The right column has three tabs: Inspect (selected node config + advanced), Tests (test list + run controls), Run (request input + timeline + step controls during runs). UI built with shadcn.

### 7.2 Node port visualization

**Symmetric expandable tree.** Both inputs (left) and outputs (right) show as port trees. Top-level branches collapsed by default; click chevron to expand. Drag from any leaf or any branch. Object ports rendered as purple dots, scalar ports as green.

### 7.3 Connection states

Four visual states, all clearly distinguishable on the canvas:

- **Branch-matched**: schemas align, both sides stay collapsed, thick blue wire with a type chip naming what flows.
- **Leaf-level**: user expanded both sides; thin individual wires per leaf.
- **Subset**: source has extra fields the dest doesn't want — thick purple wire + `+N unused` chip.
- **Partial**: dest has required fields the source can't provide — thick orange wire + `N required missing` chip + dashed red dots on unfilled inputs.

Hovering any wire highlights the implicit leaf mappings on both sides. Clicking opens an inline mapping editor.

### 7.4 Node creation flow

Right-click on canvas → context menu with "Create new node…" (⌘N) opens a dialog with name, location in the nodes tree (defaults to the workflow's folder), and a live skeleton preview. On create, the file is written, a new code editor tab opens in the same tab area, and a node is placed on the canvas at the right-click location. The same dialog opens from right-click in the nodes sidebar (folder or root), with location pre-filled. Sub-folders are supported throughout, with "+ new folder…" in the location picker.

### 7.5 Run / debug UX

A toolbar above the canvas hosts Run, Pause, Stop, and Replay. The Run button opens a small request-input panel (path/method pre-filled from the trigger; body/params/headers user-supplied). During a run: firing nodes glow blue, completed nodes turn green, queued nodes dim. Wires show live value chips. Breakpoints display as red dots on the node's left edge. When paused, the Run tab in the right column shows the resolved input bag, services in scope, step controls, and a timeline.

### 7.6 Testing UX

Right column's "Tests" tab lists tests for the current workflow (and nodes under the same path). Pass/fail rows, durations, expandable error messages. Watch mode toggleable. A failing test exposes an "open run trace" link that replays the failure on the canvas, frozen at the divergence point — making the debugger and the test runner share one execution view.

---

## 8. Decisions log (for posterity)

- Execution: interpret in dev, codegen for prod, one execution model.
- Node contract: `defineNode` helper, zero-runtime erased at build.
- File format: named-input style, view metadata segregated.
- Triggers as nodes: `@core/http-request` etc., no separate `trigger` section.
- File extension: `.workflow` (brand-neutral, future-proof for rename).
- DI: typed services bag, second arg to `run`, config-driven, factories for per-run.
- Error policy v1: fail-fast.
- Side-effect ordering: explicit `after: []` field.
- Default tokens: `{workflow_path}`, `{workflow_name}`, `{workflow_dir}`, resolved at insertion time.
- Path param folder convention: `[id]` → `:id`.
- Build target v1: Hono.
- OpenAPI v1: JSON only, client nodes only.
- AI v1: skill artifact, no in-editor AI.
- IDE Layout: three-column, shadcn UI.
- Port viz: symmetric expandable tree.

---

## 9. Open questions for later sub-projects

None block sub-project #1, but worth flagging:

1. **How are `.workflow` files parsed and edited in-IDE?** A bespoke editor (canvas only) or a split mode (canvas + raw JSON)? Probably canvas only with a "view raw" toggle.
2. **What does "save" mean for in-flight edits?** Auto-save on every change vs explicit save vs save-on-blur. Affects the `view` block's churn.
3. **Code editor pane integration with the TS LSP** — Monaco + tsserver running locally, or a server-driven LSP bridge? Defer.
4. **Where does the dev server run?** Embedded in the IDE process (Electron-style) or always-external? Affects deploy story.
5. **How do per-node "advanced" settings (timeout, retry, comments) live in the file format?** Likely as optional sibling fields next to `in` and `config`. Spec when we hit them.

These get answered in the next sub-project's design (IDE shell + graph editor).

---

## 10. What "done" looks like for sub-project #1

A user can, with no IDE:

1. `npm install @darrylondil/lorien-runtime @darrylondil/lorien-build @darrylondil/lorien-openapi`
2. Author `lorien.config.ts`, `.workflow` files, and node `.ts` files by hand (the AGENTS.md doc supports them or an AI doing this)
3. `lorien dev` runs the interpreter against their workflows; HTTP routes are live; lifecycle events stream to stdout
4. Write Vitest tests against workflows and nodes; tests pass
5. `lorien build` produces a `dist/` of plain TypeScript Hono routes
6. `node dist/index.ts` (or `bun dist/index.ts`) serves the production API
7. `lorien import-openapi petstore.json` generates `nodes/petstore/*.ts`
8. `git diff` after deleting `@darrylondil/lorien-runtime` from production deps shows zero changes needed in `dist/`

If all eight of those work end-to-end, sub-project #1 is done and we move to the IDE shell.
