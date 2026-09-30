<div align="center">

<img src="docs/images/logo.svg" alt="A gold ring around a green leaf" width="120" height="120" />

# lorien

_API workflows, woven in Lórien._

**Typed, visual HTTP APIs that you and your AI agents can both see into.**

Routes are graphs. Logic is nodes. Infrastructure is providers. Every edge is typed with [zod](https://zod.dev).
<br />
It ships as plain TypeScript with **zero lorien runtime dependency**.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![zod 4](https://img.shields.io/badge/schemas-zod%204-3068b7?logo=zod&logoColor=white)
![Hono](https://img.shields.io/badge/HTTP-Hono-e36002?logo=hono&logoColor=white)
![Node](https://img.shields.io/badge/node-%E2%89%A520-5fa04e?logo=nodedotjs&logoColor=white)
![License: MIT](https://img.shields.io/badge/license-MIT-7bd389)

[Quickstart](#quickstart) · [Why lorien](#why-lorien) · [Typed end to end](#typed-end-to-end) · [The IDE](#a-tour-of-the-ide) · [Sample](#try-the-sample) · [Packages](#packages)

</div>

<br />

![A workflow on the lorien canvas: HTTP Request, Add Pet and Response nodes wired together, with the Inspector describing Add Pet and the Debug panel showing a completed 201 run](docs/images/workflow-canvas.png)

<br />

## Quickstart

```bash
npx create-lorien my-app
cd my-app
pnpm install
pnpm dev          # dev server + IDE in your browser
```

When you're ready to ship:

```bash
pnpm build        # plain TypeScript + Hono in dist/, no lorien runtime
pnpm start
```

<details>
<summary><b>All CLI commands</b></summary>

| Command | What it does |
|---|---|
| `lorien dev` | Start the dev server and open the IDE (`--no-ide` to skip the IDE) |
| `lorien ide` | Open only the IDE |
| `lorien build` | Generate `dist/` from `workflows/`, `nodes/` and `providers/` |
| `lorien test` | Run every node case and saved request |
| `lorien import-openapi` | Generate typed client nodes from an OpenAPI 3.x spec |
| `lorien init` | Add `AGENTS.md` to an existing project |

</details>

## Why lorien

AI agents write code fast. The hard part is knowing **what they changed, where it runs, and what it touches**. In a free-form codebase, logic hides in route handlers, a second database client appears in some helper, and the only way to review is to read every diff line by line.

lorien gives your API a fixed shape that is easy to follow, for people and agents alike:

| | Pattern | What you get |
|---|---|---|
| 🗺️ | **Routes are graphs.** A `.workflow` file is a short JSON dependency graph. | You see a whole route at a glance, and a change reads as "this node now feeds that one", not a wall of handler code. |
| 🧩 | **Logic lives in nodes**, one `defineNode` per file. | Each node is small, typed and testable on its own. |
| 🔌 | **Infrastructure lives in providers**, one `defineProvider` per file. | Nodes reach a database, logger or client only through a provider, so "what touches the database?" has a one-click answer. |
| 📐 | **The rules are written down for agents.** New projects ship `AGENTS.md` and a Claude Code skill. | An agent adds a node where you would, not wherever it likes. |
| 🔎 | **Every step is observable.** The debugger records each node's inputs and outputs per request. | Tests and reviews can check any step, not just the final response. |

## Typed end to end

lorien uses **[zod](https://zod.dev) (v4)** as its schema language. A node's zod schemas are the single source of truth, and everything else is derived from them: the TypeScript types in your editor, the checks on the graph, the runtime validation, and the shapes the IDE shows. Below, `run()` knows `status` is `"available" | "pending" | "sold"` straight from the `z.enum`, with no type written by hand.

![Hovering status in the node's run function shows the type "available" | "pending" | "sold", inferred from the zod enum](docs/images/type-hover.png)

Here is where those types go:

| Layer | How it's typed |
|---|---|
| **Node inputs and outputs** | `run()` receives `z.infer<typeof inputs>` and must return `z.infer<typeof outputs>`. |
| **Providers** | `lorien` generates `.lorien/types/providers.d.ts`, so `{ db, logger }` in `run()` are typed from each provider's `create()`. |
| **Provider config** | A provider declares `env: z.object({ ... })`, and it's parsed with zod once at boot. |
| **Graph wiring** | A reference like `Request.body.name` or `AddPet.pet` is checked against the source node's output schema. A typo shows up in the IDE's Problems list before you run anything. |
| **Runtime** | Before `run()` is called, each node's inputs are parsed with its zod schema. This happens in the dev interpreter *and* in the compiled production code. |
| **The IDE** | The Inspector, value chips and enum pickers all read the schemas. That's how the HTTP `method` gets a dropdown and `pet` expands to `id · name · species · status`. |

> **Production is just TypeScript.** `lorien build` compiles each workflow into a plain [Hono](https://hono.dev) route that imports your nodes and calls `inputs.parse(...)` from zod directly. Your deployed server doesn't import lorien at all.

## A tour of the IDE

<table>
<tr>
<td width="50%" valign="top">

### 🗺️ Workflows at a glance

Open a `.workflow` and it becomes a canvas. Inputs appear as value chips on each node (`← Request.body.name`, `201`), wires are typed, and the Inspector describes the selected node from its own doc comment. Send a request and the Debug panel shows the timeline, node by node.

</td>
<td width="50%" valign="top">

### 🔌 Providers make infrastructure visible

A provider card shows its **lifetime** (`singleton`, `scoped` per request, or `transient`), the **environment variables** it needs, and **every node that reads it**. Node cards show the providers they depend on as chips.

</td>
</tr>
</table>

![The db provider: a card above its code showing its singleton lifetime, the PETSTORE_DB env var and every node that reads it](docs/images/provider.png)

### ✅ Tests next to the thing they test

![The Tests tab: workflow tests with mocks and step checks, and node test cases, all passing](docs/images/tests.png)

- **Node cases** (`*.cases.json`) run one node with given inputs, with providers mocked where it helps.
- **Workflow tests** (`*.requests.json`) are saved requests that call a route over HTTP. They can mock a node (say, to simulate `database is locked`) and check what any step received or returned.
- **`lorien test`** runs all of them in CI. The IDE badges each node and file with its pass count.

When a request fails, the Debug panel names the node that failed and offers **Ask AI to fix** with the trace attached.

## Project layout

```text
my-app/
├── lorien.config.ts        # build target
├── workflows/              # HTTP routes as JSON dependency graphs
│   ├── *.workflow
│   └── *.requests.json     #   saved requests: the route's workflow tests
├── nodes/                  # typed compute units (defineNode): all business logic
│   ├── *.ts
│   └── *.cases.json        #   test cases for the node beside it
├── providers/              # injected dependencies (defineProvider): db, logger, clients
│   └── <name>.ts           #   singleton, scoped (per request) or transient
├── lib/                    # plain shared code: zod schemas, helpers
├── src/server.ts           # entrypoint, calls startLorienServer
└── AGENTS.md               # the author's guide for humans and AI agents
```

A workflow is small enough to review in a diff:

```json
{
  "lorien": 1,
  "nodes": {
    "Request":  { "uses": "@core/http-request", "values": { "path": "/pets", "method": "POST" } },
    "AddPet":   { "uses": "./nodes/pets/add-pet",
                  "in": { "name": "Request.body.name", "species": "Request.body.species" } },
    "Response": { "uses": "@core/response", "in": { "body": "AddPet.pet" }, "values": { "status": 201 } }
  }
}
```

And a provider is one file whose name is how nodes read it:

```ts
// providers/db.ts  →  nodes receive it as `db`
export default defineProvider({
  name: "Pet store database",
  env: z.object({
    PETSTORE_DB: z.string().default(join(import.meta.dirname, "..", "data", "petstore.db")),
  }),
  create: ({ env }) => openPetStoreDb(env.PETSTORE_DB),
  dispose: (db) => db.close(),
})
```

## Try the sample

[`examples/basic-api`](examples/basic-api) is a small pet store on Node's built-in SQLite (Node 22.13+). It has six routes, a `db` and a `logger` provider, and tests at every layer. The screenshots above show it in the IDE.

```bash
git clone https://github.com/darrylhuffman/lorien.git
cd lorien
pnpm install
pnpm -r build
pnpm dev:demo     # IDE on http://localhost:5173, backed by examples/basic-api
```

## Packages

| Package | What it is |
|---|---|
| [`@darrylondil/lorien-runtime`](packages/runtime) | Headless interpreter, `defineNode` / `defineProvider`, testing primitives. Peer deps: `zod` 4, `hono` 4 |
| [`@darrylondil/lorien-build`](packages/build) | The `lorien` CLI: build, dev, ide, test, init, import-openapi |
| [`@darrylondil/lorien-openapi`](packages/openapi) | OpenAPI 3.x to typed client-node generator |
| [`@darrylondil/lorien-ide`](packages/ide) | Browser IDE: Vite, React 19, Tailwind v4, React Flow, Monaco |
| [`create-lorien`](packages/create-lorien-api) | `npx create-lorien <name>` scaffolder |

## Development

This is a pnpm workspace.

```bash
pnpm install              # install all workspaces
pnpm -r build             # build every package
pnpm test                 # run every package's tests
pnpm -r typecheck         # tsc across the workspace
pnpm exec biome check .   # lint + format check
```

To work on the IDE with live data from the sample, run `pnpm -r build` once, then `pnpm dev:demo`. It starts the backend (`lorien ide --no-open --root examples/basic-api --port 3737`, serving `/api/*`) and the Vite dev server on port 5173, which proxies `/api/*` to it with HMR. Browser tests for the IDE live in `packages/ide/e2e` and run against the real IDE server on the sample.

**Docs:** [node tests](docs/node-tests.md) · [saved requests](docs/saved-requests.md) · design specs and plans in `docs/superpowers/` · [publishing](PUBLISHING.md)

## License

MIT, see [`LICENSE`](LICENSE). Issues and pull requests are welcome at [github.com/darrylhuffman/lorien](https://github.com/darrylhuffman/lorien).

<br />

<div align="center">
<sub>The name is a nod to Lothlórien, the golden wood in Tolkien's <i>The Lord of the Rings</i>.</sub>
</div>
