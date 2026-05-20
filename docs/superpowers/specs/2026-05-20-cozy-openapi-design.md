# `@lorien/openapi` — design supplement

**Date:** 2026-05-20
**Builds on:** `2026-05-20-lorien-api-design.md` §3.10 (OpenAPI client-node import)
**Scope:** Plan #3 — the `@lorien/openapi` package
**Status:** design approved, ready for plan-writing

---

## Why this supplement

The original spec §3.10 covered OpenAPI import semantically:
- JSON OpenAPI 3.x only (no XML/YAML for v1)
- One node per operation under `nodes/<api-slug>/`
- Each node generated as plain `defineNode` TS file with Zod schemas derived from the spec + a `fetch` call in `run()`
- Re-importing preserves user edits via guards

This supplement pins down the implementation choices.

## Architecture

`@lorien/openapi` is a new monorepo package: `packages/openapi/`. It exports:
- A pure `convertOpenApiSpec(spec, opts): GeneratedFiles` function that takes parsed OpenAPI JSON and returns a map of `<path>: <ts source>` to write
- A `writeGeneratedFiles(files, opts)` helper that handles conflicts (skip existing or `--force` overwrite)
- Schemas-and-types-only — no CLI binary

The `lorien import-openapi` CLI command in `@lorien/build` becomes a thin wrapper: read JSON, call `@lorien/openapi`, write to disk, print summary. (Replaces the stub from Plan #2.)

## Library choices

| Decision | Going with | Why |
|---|---|---|
| **OpenAPI types** | `openapi-types` (type-only) | Industry-standard TypeScript types for OAS 3.x. Zero runtime overhead. |
| **OpenAPI parsing** | Hand-written validator | OAS structure is well-defined and we only need the subset that maps to defineNode. A heavyweight parser (`@redocly/openapi-core`, `swagger-parser`) is overkill. |
| **`$ref` resolution** | Local refs only (`#/components/schemas/Foo`) | External `$ref` (`http://...`, file paths) errors out with a clear message in v1.0. Most real-world specs use local refs. |
| **OpenAPI Schema → Zod** | Hand-written converter | Maps `type: string` → `z.string()`, `format: email` → `z.string().email()`, etc. Predictable, debuggable. Libraries like `openapi-zod-client` exist but bring opinions we don't need. |
| **HTTP client in emitted code** | `fetch` (native) | Node 18+ ships native fetch. No dep. Aligns with the rest of the codebase. |

## Output structure

For a spec named `petstore` (slug derived from `info.title`):

```
nodes/
└── petstore/
    ├── _client.ts                 # shared base URL + auth config helper
    ├── get-pet-by-id.ts           # GET /pets/{petId}
    ├── add-pet.ts                 # POST /pets
    └── list-pets.ts               # GET /pets
```

Each operation node file looks like:

```ts
// lorien-openapi: generated from petstore.json operation `getPetById`.
// Do NOT edit manually — re-run `lorien import-openapi petstore.json` to regenerate.
import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"
import { baseUrl, buildHeaders } from "./_client.js"

export default defineNode({
  name: "Get Pet by ID",
  inputs: z.object({
    pathParams: z.object({ petId: z.string() }),
    headers: z.object({}).optional(),
  }),
  outputs: z.object({
    pet: z.object({
      id: z.number(),
      name: z.string(),
      // ... derived from petstore.yaml#/components/schemas/Pet
    }),
  }),
  async run({ pathParams, headers }) {
    const url = new URL(`/pets/${pathParams.petId}`, baseUrl())
    const res = await fetch(url, {
      method: "GET",
      headers: buildHeaders(headers),
    })
    if (!res.ok) throw new Error(`getPetById failed: ${res.status} ${res.statusText}`)
    return { pet: await res.json() }
  },
})
```

The `_client.ts` helper:

```ts
// lorien-openapi: generated. Edit baseUrl()/buildHeaders() to customize.
export function baseUrl(): string {
  return process.env.PETSTORE_BASE_URL ?? "https://petstore.example.com/v3"
}

export function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(extra ?? {}),
  }
}
```

The user can edit `_client.ts` for auth, retries, etc. The per-operation files are regenerated.

## Re-import safety

Generated files have a header comment marker:
```ts
// lorien-openapi: generated from <spec-name> operation `<id>`.
// Do NOT edit manually — re-run `lorien import-openapi <spec>` to regenerate.
```

`lorien import-openapi <spec>` v1.0 behavior:
- Files containing the marker → overwritten
- Files NOT containing the marker → preserved (the user manually authored or modified)
- `--force` → overwrites everything

`_client.ts` is special — generated only on first import; preserved on re-import unless `--force`. (User customizations of base URL / auth survive re-imports.)

## OpenAPI → Zod conversion rules

Subset supported in v1.0:

| OAS form | Zod equivalent |
|---|---|
| `type: string` | `z.string()` |
| `type: string, format: email` | `z.string().email()` |
| `type: string, format: uuid` | `z.string().uuid()` |
| `type: string, format: date-time` | `z.string().datetime()` |
| `type: string, enum: [...]` | `z.enum([...] as const)` |
| `type: integer` / `type: number` | `z.number()` |
| `type: integer, minimum/maximum` | `z.number().int().min().max()` |
| `type: boolean` | `z.boolean()` |
| `type: array, items: <schema>` | `z.array(<converted>)` |
| `type: object, properties: {...}` | `z.object({...})` with required list applied |
| `nullable: true` | `.nullable()` chained |
| `$ref: '#/components/schemas/Foo'` | Resolved + converted (cycle detection) |

Out of scope for v1.0 (skip with warning):
- `allOf`, `oneOf`, `anyOf` (composition) — emit `z.unknown()` + comment
- `discriminator` (polymorphism)
- `additionalProperties` (open records)
- `$ref` to external files / URLs
- `application/xml`, `multipart/form-data`, `application/x-www-form-urlencoded` request bodies (only `application/json` and url-encoded query params)

These can land in v1.1 as the surface area grows.

## v1.0 acceptance

After Plan #3:

1. `lorien import-openapi /path/to/petstore.json` generates `nodes/petstore/*.ts`
2. Each generated node compiles cleanly with `tsc --noEmit`
3. A user can `import getPetById from "./nodes/petstore/get-pet-by-id"` and call it (with a mocked fetch) — full type safety
4. A user can use it in a workflow that mounts via `startLorienServer` and runs end-to-end with a mocked target API
5. Re-running `lorien import-openapi` is idempotent (same input → same files)
6. Editing `_client.ts` to set a custom base URL survives re-imports

## Plan #3 task structure

1. `@lorien/openapi` package scaffold
2. OpenAPI 3.x JSON loader + structural validator
3. `$ref` resolver (local refs, cycle detection)
4. OpenAPI Schema → Zod schema converter
5. Per-operation node file emitter (the defineNode + fetch generator)
6. `_client.ts` emitter (base URL + headers helper)
7. Multi-operation orchestrator (`convertOpenApiSpec` function)
8. File-writing helper with re-import safety (markers, --force)
9. Wire `lorien import-openapi` in `@lorien/build` to call `@lorien/openapi` (replaces Plan #2's stub)
10. Acceptance: import a real petstore spec, generated nodes compile + work in a workflow

Roughly the same scale as Plan #2 — 10 tasks, mostly small. Total monorepo packages after Plan #3: 4 (runtime, build, openapi, create-lorien-api).
