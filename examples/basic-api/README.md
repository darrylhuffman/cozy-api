# basic-api example: a pet store

A small lorien-api project demonstrating workflows, nodes and services, backed by
a SQLite database (Node's built-in `node:sqlite`, so there is nothing to install).

## Routes

| Method  | Path               | Workflow                              |
| ------- | ------------------ | ------------------------------------- |
| `GET`   | `/pets`            | `workflows/pets/list.workflow` (`?status=`, `?species=`) |
| `POST`  | `/pets`            | `workflows/pets/add.workflow`         |
| `GET`   | `/pets/:id`        | `workflows/pets/get.workflow`         |
| `PATCH` | `/pets/:id`        | `workflows/pets/update.workflow`      |
| `GET`   | `/store/inventory` | `workflows/store/inventory.workflow`  |
| `POST`  | `/store/orders`    | `workflows/store/orders/place.workflow` |

## Database

The `db` service in `lorien.config.ts` opens `data/petstore.db` (git-ignored),
creating and seeding it with a few pets the first time. Delete the file to start
over, or set `PETSTORE_DB` to another path. Tests use `PETSTORE_DB=:memory:`, so
each run gets a fresh, seeded database. Needs Node 22.13 or newer.

## Tests

Every node and every workflow ships with tests, at three levels:

- **Node cases** (`nodes/**/*.cases.json`): one node, given inputs, with services
  mocked where it helps. The IDE's **Tests** tab edits and runs them.
- **Workflow tests** (`workflows/**/*.test.ts`): a whole workflow run in-process
  with `testWorkflow` / `traceWorkflow` against a fresh in-memory pet store. They
  check the response and what each node received and returned, so they catch wiring
  mistakes such as a query param going to the wrong input.
  `src/workflow-test-kit.ts` loads the workflow, the nodes and the services.
- **Saved requests** (`workflows/**/*.requests.json`): real HTTP calls against the
  running app, chained with captured values. The IDE's **Run** tab edits and runs them.

`pnpm test` runs all three.

## Scripts

- `pnpm dev` — start the dev server (tsx src/server.ts)
- `pnpm test` — run unit and integration tests
- `pnpm typecheck` — run tsc --noEmit
- `pnpm build` — produce production dist/ via `lorien build`
- `pnpm start` — run the built dist (node dist/index.js)

## Layout

- `workflows/` — HTTP routes as `.workflow` JSON files, with saved requests in `*.requests.json`
- `nodes/` — typed compute units, with test cases in `*.cases.json`
- `src/db.ts` — the SQLite pet store behind the `db` service
- `lorien.config.ts` — service registry
- `src/server.ts` — dev entry (uses `startLorienServer`)
