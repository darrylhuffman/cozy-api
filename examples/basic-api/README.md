# basic-api example: a pet store

A small lorien-api project demonstrating workflows, nodes and providers, backed by
a SQLite database (Node's built-in `node:sqlite`, so there is nothing to install).

## Routes

| Method  | Path               | Workflow                              |
| ------- | ------------------ | ------------------------------------- |
| `GET`   | `/pets`            | `workflows/pets/list.workflow` (`?status=`, `?species=`) |
| `POST`  | `/pets`            | `workflows/pets/add.workflow`         |
| `GET`   | `/pets/:id`        | `workflows/pets/get.workflow`         |
| `PATCH` | `/pets/:id`        | `workflows/pets/update.workflow`      |
| `GET`   | `/store/inventory` | `workflows/store/inventory.workflow`  |
| `GET`   | `/store/catalog`   | `workflows/store/catalog.workflow` (`?status=`, `?species=`, `?page=`, `?pageSize=`) |
| `POST`  | `/store/orders`    | `workflows/store/orders/place.workflow` |

## The catalog: several nodes in one workflow

`GET /store/catalog` shows how nodes combine. The request fans out to two nodes
that run side by side: **List Pets** (the same node `GET /pets` uses) and **Get
Inventory**. Both feed **To Catalog Page**, a DTO mapper that uses no providers. It
turns database rows into what the client wants: display-ready items with a
`canOrder` flag, one page of results, paging info, and the store-wide counts.

```json
{
  "items": [{ "id": 1, "name": "Biscuit", "species": "Dog", "status": "available", "canOrder": true }],
  "page": 1, "pageSize": 10, "totalItems": 4, "totalPages": 1, "hasNextPage": false,
  "storeCounts": { "available": 2, "pending": 1, "sold": 1 }
}
```

## Database

The `db` provider in `providers/db.ts` opens `data/petstore.db` (git-ignored) once at boot,
creating and seeding it with a few pets the first time. Delete the file to start
over, or set `PETSTORE_DB` to another path. Tests use `PETSTORE_DB=:memory:`, so
each run gets a fresh, seeded database. Needs Node 22.13 or newer.

## Tests

Every node and every workflow ships with tests:

- **Node cases** (`nodes/**/*.cases.json`): one node, given inputs, with providers
  mocked where it helps. The IDE's **Tests** tab edits and runs them.
- **Workflow tests** (`workflows/**/*.requests.json`): saved requests that call each
  workflow over HTTP, chain values between calls with `capture`, and check the
  response. They cover the happy path, 404s, 409s and invalid input. The IDE runs
  them from the **Run** tab, and `lorien test` runs them in CI. They create the pets
  they change, so they pass again and again against the IDE's persistent database.
- **Workflow code tests** (`workflows/**/*.test.ts`): Vitest runs each workflow
  in-process with `traceWorkflow` against a fresh in-memory pet store. They check
  what each node received and returned (for example, that `?status=` reaches List
  Pets' `status` input), which a saved request can't see. `src/workflow-test-kit.ts`
  loads the workflow, the nodes and the providers.

`pnpm test` runs all of them.

## Scripts

- `pnpm dev` — start the dev server (tsx src/server.ts)
- `pnpm test` — run unit and integration tests
- `pnpm typecheck` — run tsc --noEmit
- `pnpm build` — produce production dist/ via `lorien build`
- `pnpm start` — run the built dist (node dist/index.js)

## Layout

- `workflows/` — HTTP routes as `.workflow` JSON files, with saved requests in `*.requests.json`
  - `_middleware.ts` — runs before every route: logs the request and sets `x-response-time`
- `nodes/` — typed compute units, with test cases in `*.cases.json`
- `providers/` — dependencies injected into every node, one file each:
  - `db.ts` — the SQLite pet store (singleton); its SQL lives in `providers/db/`
  - `logger.ts` — a per-request logger that tags lines with the request id (scoped)
- `lib/schemas.ts` — zod schemas shared by nodes
- `lorien.config.ts` — build target
- `src/server.ts` — dev entry (uses `startLorienServer`)
