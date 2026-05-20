# lorien

In-browser IDE and runtime for building HTTP APIs through a typed drag-and-drop graph editor. Workflows compile to plain TypeScript at build time — production code has zero `lorien` runtime dependency.

## Quickstart

```bash
# Create a new project
npx create-lorien my-app
cd my-app
pnpm install

# Start the dev server + open the IDE
pnpm dev

# Or just the dev server, no IDE
pnpm dev:server

# Or just the IDE
pnpm exec lorien ide

# Build for production
pnpm build
pnpm start
```

## What's inside

Lorien is a monorepo of five packages:

| Package | What it is |
|---|---|
| `@darrylondil/lorien-runtime` | Headless interpreter, `defineNode` helper, testing primitives |
| `@darrylondil/lorien-build` | The `lorien` CLI: build, dev, ide, init, import-openapi |
| `@darrylondil/lorien-openapi` | OpenAPI 3.x → client-node generator |
| `@darrylondil/lorien-ide` | Browser IDE — Vite + React 19 + Tailwind v4 + shadcn |
| `create-lorien` | `npx create-lorien <name>` scaffolder |

## Project layout (after scaffolding)

```
my-app/
├── lorien.config.ts        # service registry (db, logger, etc.)
├── workflows/              # HTTP routes as JSON dependency graphs
│   └── *.workflow
├── nodes/                  # typed compute units (defineNode)
│   └── *.ts
├── src/
│   └── server.ts           # entrypoint — calls startLorienServer
├── AGENTS.md               # author's guide for humans + AI agents
└── README.md
```

## Documentation

- Design specs: `docs/superpowers/specs/`
- Implementation plans: `docs/superpowers/plans/`
- Publishing guide: `PUBLISHING.md`
- License: MIT (see `LICENSE`)

## Development

This is a pnpm workspace. Common commands:

```bash
pnpm install          # install all workspaces
pnpm -r build         # build every package
pnpm test             # run every package's tests
pnpm -r typecheck     # tsc across the workspace
pnpm exec biome check . # lint + format check
```

To work on the IDE specifically:

```bash
cd packages/ide
pnpm dev              # Vite dev server with HMR on http://localhost:5173
```

## Status

v0.1.0 — runtime + build + openapi + IDE shell are shipped. Sub-projects remaining:

- \#4 Visual graph editor (workflow editor inside the IDE)
- \#5 Code editor pane (Monaco + TS LSP)
- \#7 Debugger UI (live values on wires, breakpoints)
- \#8 `@darrylondil/lorien-ide-server` (backend bridge: real file ops + runtime telemetry)
