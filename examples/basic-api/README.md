# basic-api example

A minimal lorien-api project demonstrating workflows + nodes + services.

## Scripts

- `pnpm dev` — start the dev server (tsx src/server.ts)
- `pnpm test` — run unit and integration tests
- `pnpm typecheck` — run tsc --noEmit
- `pnpm build` — produce production dist/ via `lorien build`
- `pnpm start` — run the built dist (node dist/index.js)

## Layout

- `workflows/` — HTTP routes as `.workflow` JSON files
- `nodes/` — typed compute units
- `lorien.config.ts` — service registry
- `src/server.ts` — dev entry (uses `startLorienServer`)
