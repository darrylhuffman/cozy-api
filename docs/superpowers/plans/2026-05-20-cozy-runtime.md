# @cozy/runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@cozy/runtime` — the headless heart of cozy-api. After this plan, a user can write `cozy.config.ts`, `.workflow` JSON files, and `defineNode` TS files by hand and run them end-to-end through a Hono-backed interpreter, with DI, lifecycle events, breakpoint-ready hooks, and Vitest test helpers.

**Architecture:** Single TypeScript ESM package. A dataflow scheduler walks `.workflow` files, calls user-authored node `.run()` functions in dependency order (parallel where possible), threads a typed services bag through each call, and emits lifecycle events to subscribers. Two built-in nodes (`@core/http-request`, `@core/response`) provide the HTTP entry and exit. A thin `startDevServer()` function wires the interpreter to a Hono server.

**Tech Stack** (versions are current latest stable as of 2026-05-20; check `npm view <pkg> version` before re-running this plan and bump if stale):
- TypeScript 6.0+ (strict, ES2022, NodeNext modules)
- pnpm 11+ workspaces (monorepo, room for `@cozy/build` and `@cozy/openapi` later)
- Vitest 4+ (test runner; the spec requires Vitest for users too, so we dogfood)
- tsup 8.5+ (library bundler — ESM output with types, no fuss)
- Biome 2.4+ (lint + format, single tool)
- Hono 4.12+ (peer dep — used by the built-in HTTP trigger and dev server)
- Zod 4+ (peer dep — node schemas; v4 has the two-arg `z.record(K, V)` form we use)
- Node 20+ runtime target

**Conventions used throughout:**
- Source tests are co-located: `src/foo.ts` + `src/foo.test.ts`
- All files ESM (`import`/`export`, no CJS)
- Imports use `.js` extensions (NodeNext convention) even though source is `.ts`
- Public API re-exports from `packages/runtime/src/index.ts`
- Commits use Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`)

---

## File structure (after this plan completes)

```
cozy-api/
├── package.json                    # root, pnpm workspace declaration
├── pnpm-workspace.yaml             # declares packages/*
├── tsconfig.base.json              # shared strict TS config
├── biome.json                      # lint/format config
├── .gitignore                      # already exists
├── packages/
│   └── runtime/
│       ├── package.json
│       ├── tsconfig.json           # extends base
│       ├── tsup.config.ts          # bundler config
│       ├── vitest.config.ts
│       ├── src/
│       │   ├── index.ts            # public API exports
│       │   ├── types.ts            # core type definitions
│       │   ├── define-node.ts
│       │   ├── define-trigger.ts
│       │   ├── define-config.ts
│       │   ├── workflow/
│       │   │   ├── schema.ts       # Zod schema for WorkflowFile shape
│       │   │   ├── reference.ts    # parse/resolve "node.path.to.field"
│       │   │   ├── parse.ts        # JSON → typed WorkflowFile
│       │   │   ├── validate.ts     # resolve refs, detect cycles
│       │   │   └── types.ts        # WorkflowFile, NodeInstance, Reference
│       │   ├── services/
│       │   │   ├── resolve.ts      # build per-run services bag from config
│       │   │   ├── dispose.ts      # await dispose() across services
│       │   │   └── types.ts        # Services, ServiceContext
│       │   ├── exec/
│       │   │   ├── topology.ts     # compute topological + parallel groups
│       │   │   ├── lifecycle.ts    # lifecycle event emitter
│       │   │   ├── run.ts          # the workflow interpreter
│       │   │   └── errors.ts       # WorkflowError + fail-fast policy
│       │   ├── core/
│       │   │   ├── http-request.ts # @core/http-request built-in
│       │   │   ├── response.ts     # @core/response built-in
│       │   │   └── registry.ts     # maps "@core/<name>" to module
│       │   ├── testing/
│       │   │   ├── index.ts        # testWorkflow, traceWorkflow exports
│       │   │   ├── test-workflow.ts
│       │   │   └── trace-workflow.ts
│       │   └── dev-server/
│       │       ├── load.ts         # discover workflows/nodes/config in dir
│       │       └── server.ts       # startDevServer(opts): Hono mount
│       └── (test files co-located with .test.ts)
├── examples/
│   └── basic-api/                  # used in the acceptance test
└── docs/                           # already exists
```

---

## Task 1: Monorepo skeleton + root configs

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `biome.json`
- Modify: `.gitignore` (already exists; add nothing new — it already covers everything we need)

- [ ] **Step 1: Create root package.json**

Write `package.json`:

```json
{
  "name": "cozy-api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.1.3",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.15",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

Write `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "examples/*"

# Greenfield project — we want latest versions of everything.
# Default pnpm 11 minimum-release-age policy would block recent packages
# (e.g. vite 6+, which vitest 4 requires).
minimumReleaseAge: 0

# Allow build scripts for packages that need them
allowBuilds:
  esbuild: true
```

- [ ] **Step 3: Create tsconfig.base.json**

Write `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "ignoreDeprecations": "6.0"
  }
}
```

(`ignoreDeprecations: "6.0"` silences a TS 6 deprecation warning that tsup 8.5's internal DTS pipeline still triggers via `baseUrl`. Remove once tsup catches up.)

- [ ] **Step 4: Create biome.json**

Write `biome.json` (v2 format — `files.includes` with negated patterns, `assist.actions.source` for import organization, `javascript.formatter.semicolons: asNeeded` to keep the no-semi style used throughout the codebase):

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.15/schema.json",
  "files": {
    "includes": ["**", "!**/dist", "!**/node_modules", "!**/.cozy", "!**/.superpowers"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "semicolons": "asNeeded",
      "quoteStyle": "double",
      "trailingCommas": "all"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "noNonNullAssertion": "off",
        "useImportType": "error"
      }
    }
  },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

- [ ] **Step 5: Install root deps and verify**

Run: `pnpm install`
Expected: pnpm creates `pnpm-lock.yaml`, installs biome + typescript at the root, no errors.

Run: `pnpm exec biome check .`
Expected: passes (no source files yet).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json biome.json pnpm-lock.yaml
git commit -m "chore: monorepo skeleton with pnpm workspaces, tsconfig, biome"
```

---

## Task 2: @cozy/runtime package scaffold

**Files:**
- Create: `packages/runtime/package.json`
- Create: `packages/runtime/tsconfig.json`
- Create: `packages/runtime/tsup.config.ts`
- Create: `packages/runtime/vitest.config.ts`
- Create: `packages/runtime/src/index.ts`
- Create: `packages/runtime/src/index.test.ts`

- [ ] **Step 1: Create package.json**

Write `packages/runtime/package.json`:

```json
{
  "name": "@cozy/runtime",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing/index.d.ts",
      "default": "./dist/testing/index.js"
    }
  },
  "files": [
    "dist",
    "src",
    "README.md"
  ],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "hono": "^4.12.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^25.9.1",
    "hono": "^4.12.21",
    "tsup": "^8.5.1",
    "vitest": "^4.1.7",
    "zod": "^4.4.3"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Write `packages/runtime/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "dist"]
}
```

- [ ] **Step 3: Create tsup.config.ts**

Write `packages/runtime/tsup.config.ts`:

```ts
import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "testing/index": "src/testing/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
})
```

- [ ] **Step 4: Create vitest.config.ts**

Write `packages/runtime/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    typecheck: { enabled: true, include: ["src/**/*.test-d.ts"] },
  },
})
```

- [ ] **Step 5: Create stub src/index.ts**

Write `packages/runtime/src/index.ts`:

```ts
export const VERSION = "0.0.0"
```

- [ ] **Step 6: Create scaffolding test**

Write `packages/runtime/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { VERSION } from "./index.js"

describe("@cozy/runtime package", () => {
  it("exports a version string", () => {
    expect(VERSION).toBe("0.0.0")
  })
})
```

- [ ] **Step 7: Install package deps**

Run: `pnpm install`
Expected: workspace resolves, `packages/runtime` deps installed (hono, zod, tsup, vitest, etc.).

- [ ] **Step 8: Verify build + test + typecheck**

Run: `pnpm --filter @cozy/runtime typecheck`
Expected: passes.

Run: `pnpm --filter @cozy/runtime test`
Expected: 1 test passes.

Run: `pnpm --filter @cozy/runtime build`
Expected: `dist/index.js`, `dist/index.d.ts` produced.

- [ ] **Step 9: Create stub testing entry**

Write `packages/runtime/src/testing/index.ts`:

```ts
export const TESTING_VERSION = "0.0.0"
```

Run: `pnpm --filter @cozy/runtime build`
Expected: `dist/testing/index.js` also produced.

- [ ] **Step 10: Commit**

```bash
git add packages/runtime/ pnpm-lock.yaml
git commit -m "feat(runtime): scaffold @cozy/runtime package with tsup + vitest"
```

---

## Task 3: Core type definitions

**Files:**
- Create: `packages/runtime/src/types.ts`
- Create: `packages/runtime/src/types.test-d.ts`

- [ ] **Step 1: Write failing type test**

Write `packages/runtime/src/types.test-d.ts`:

```ts
import type { z } from "zod"
import { expectTypeOf, test } from "vitest"
import type {
  Node,
  ServiceContext,
  Services,
  Trigger,
  WorkflowConfig,
} from "./types.js"

test("Node has required fields", () => {
  type N = Node<z.ZodObject<{ a: z.ZodString }>, z.ZodObject<{ b: z.ZodNumber }>>
  expectTypeOf<N>().toHaveProperty("inputs")
  expectTypeOf<N>().toHaveProperty("outputs")
  expectTypeOf<N>().toHaveProperty("run")
})

test("Trigger has no inputs, no run", () => {
  type T = Trigger<z.ZodObject<{ a: z.ZodString }>>
  expectTypeOf<T>().toHaveProperty("outputs")
  // @ts-expect-error -- triggers should not declare inputs
  expectTypeOf<T>().toHaveProperty("inputs")
})

test("Services interface exists and supports augmentation", () => {
  // The base interface is empty; users add fields via declaration merging
  // (.cozy/types/services.d.ts generated by @cozy/build). Verify that
  // augmentation produces a structurally-typed object.
  type Augmented = Services & { db: string }
  expectTypeOf<Augmented>().toHaveProperty("db")
})

test("ServiceContext has requestId and timestamp", () => {
  expectTypeOf<ServiceContext>().toEqualTypeOf<{ requestId: string; timestamp: number }>()
})

test("WorkflowConfig has services and target", () => {
  expectTypeOf<WorkflowConfig>().toHaveProperty("services")
  expectTypeOf<WorkflowConfig>().toHaveProperty("target")
})
```

- [ ] **Step 2: Run type test to verify failure**

Run: `pnpm --filter @cozy/runtime test`
Expected: type errors — file `types.ts` doesn't exist.

- [ ] **Step 3: Write src/types.ts**

Write `packages/runtime/src/types.ts`:

```ts
import type { z } from "zod"

/**
 * Augmentable interface populated by the IDE's type generator from cozy.config.ts.
 * Users never write this themselves; .cozy/types/services.d.ts declares it.
 */
export interface Services {
  // populated via declaration merging in generated .d.ts files
}

export interface ServiceContext {
  requestId: string
  timestamp: number
}

export type ServiceValue<T = unknown> = T | ((ctx: ServiceContext) => T | Promise<T>)

export interface Disposable {
  dispose?(): void | Promise<void>
}

export interface WorkflowConfig {
  target: "hono"
  services: Record<string, ServiceValue<unknown>>
}

export type ZodObjectAny = z.ZodObject<z.ZodRawShape>

export interface Node<
  I extends ZodObjectAny = ZodObjectAny,
  O extends ZodObjectAny = ZodObjectAny,
  C extends ZodObjectAny | undefined = ZodObjectAny | undefined,
> {
  readonly kind: "node"
  readonly name?: string
  readonly inputs: I
  readonly outputs: O
  readonly config?: C
  run(
    input: z.infer<I>,
    services: Services,
    config: C extends ZodObjectAny ? z.infer<C> : undefined,
  ): Promise<z.infer<O>>
}

export interface Trigger<
  O extends ZodObjectAny = ZodObjectAny,
  C extends ZodObjectAny | undefined = ZodObjectAny | undefined,
> {
  readonly kind: "trigger"
  readonly name?: string
  readonly outputs: O
  readonly config?: C
}

export type AnyNodeOrTrigger = Node | Trigger
```

- [ ] **Step 4: Run type test to verify pass**

Run: `pnpm --filter @cozy/runtime test`
Expected: type tests pass.

- [ ] **Step 5: Re-export from index**

Edit `packages/runtime/src/index.ts`:

```ts
export const VERSION = "0.0.0"
export type {
  Node,
  Trigger,
  Services,
  ServiceContext,
  ServiceValue,
  Disposable,
  WorkflowConfig,
} from "./types.js"
```

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/types.ts packages/runtime/src/types.test-d.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): core type definitions (Node, Trigger, Services, WorkflowConfig)"
```

---

## Task 4: defineNode helper

**Files:**
- Create: `packages/runtime/src/define-node.ts`
- Create: `packages/runtime/src/define-node.test.ts`

- [ ] **Step 1: Write failing test**

Write `packages/runtime/src/define-node.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineNode } from "./define-node.js"

describe("defineNode", () => {
  it("preserves the definition object", () => {
    const node = defineNode({
      name: "Greet",
      inputs: z.object({ who: z.string() }),
      outputs: z.object({ greeting: z.string() }),
      async run({ who }) {
        return { greeting: `Hello, ${who}` }
      },
    })
    expect(node.name).toBe("Greet")
    expect(node.kind).toBe("node")
    expect(node.inputs).toBeDefined()
    expect(node.outputs).toBeDefined()
  })

  it("the run function works when invoked directly", async () => {
    const node = defineNode({
      inputs: z.object({ a: z.number(), b: z.number() }),
      outputs: z.object({ sum: z.number() }),
      async run({ a, b }) {
        return { sum: a + b }
      },
    })
    // Direct invocation: a node IS a callable module.
    const result = await node.run({ a: 2, b: 3 }, {} as never, undefined)
    expect(result).toEqual({ sum: 5 })
  })

  it("infers run's input type from the inputs schema", () => {
    // This compiles only if defineNode's generics flow correctly.
    defineNode({
      inputs: z.object({ name: z.string(), age: z.number() }),
      outputs: z.object({ ok: z.boolean() }),
      async run({ name, age }) {
        const _typed: string = name
        const _typedAge: number = age
        return { ok: name.length > 0 && age > 0 }
      },
    })
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @cozy/runtime test`
Expected: import errors — `define-node.ts` doesn't exist.

- [ ] **Step 3: Write src/define-node.ts**

Write `packages/runtime/src/define-node.ts`:

```ts
import type { z } from "zod"
import type { Node, Services, ZodObjectAny } from "./types.js"

export interface DefineNodeInput<
  I extends ZodObjectAny,
  O extends ZodObjectAny,
  C extends ZodObjectAny | undefined,
> {
  name?: string
  inputs: I
  outputs: O
  config?: C
  run(
    input: z.infer<I>,
    services: Services,
    config: C extends ZodObjectAny ? z.infer<C> : undefined,
  ): Promise<z.infer<O>>
}

export function defineNode<
  I extends ZodObjectAny,
  O extends ZodObjectAny,
  C extends ZodObjectAny | undefined = undefined,
>(def: DefineNodeInput<I, O, C>): Node<I, O, C> {
  return {
    kind: "node",
    name: def.name,
    inputs: def.inputs,
    outputs: def.outputs,
    config: def.config,
    run: def.run,
  } as Node<I, O, C>
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @cozy/runtime test`
Expected: 3 tests pass.

- [ ] **Step 5: Re-export from index**

Edit `packages/runtime/src/index.ts`, add the export:

```ts
export { defineNode } from "./define-node.js"
export type { DefineNodeInput } from "./define-node.js"
```

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/define-node.ts packages/runtime/src/define-node.test.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): defineNode helper with full type inference from Zod schemas"
```

---

## Task 5: defineTrigger and defineConfig helpers

**Files:**
- Create: `packages/runtime/src/define-trigger.ts`
- Create: `packages/runtime/src/define-trigger.test.ts`
- Create: `packages/runtime/src/define-config.ts`
- Create: `packages/runtime/src/define-config.test.ts`

- [ ] **Step 1: Write defineTrigger failing test**

Write `packages/runtime/src/define-trigger.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineTrigger } from "./define-trigger.js"

describe("defineTrigger", () => {
  it("creates a trigger with kind='trigger'", () => {
    const trigger = defineTrigger({
      name: "HTTP Request",
      config: z.object({ path: z.string(), method: z.string() }),
      outputs: z.object({ body: z.unknown() }),
    })
    expect(trigger.kind).toBe("trigger")
    expect(trigger.name).toBe("HTTP Request")
  })

  it("triggers don't have run() or inputs", () => {
    const trigger = defineTrigger({
      outputs: z.object({ x: z.number() }),
    })
    expect((trigger as Record<string, unknown>).run).toBeUndefined()
    expect((trigger as Record<string, unknown>).inputs).toBeUndefined()
  })
})
```

- [ ] **Step 2: Write src/define-trigger.ts**

Write `packages/runtime/src/define-trigger.ts`:

```ts
import type { Trigger, ZodObjectAny } from "./types.js"

export interface DefineTriggerInput<
  O extends ZodObjectAny,
  C extends ZodObjectAny | undefined,
> {
  name?: string
  outputs: O
  config?: C
}

export function defineTrigger<
  O extends ZodObjectAny,
  C extends ZodObjectAny | undefined = undefined,
>(def: DefineTriggerInput<O, C>): Trigger<O, C> {
  return {
    kind: "trigger",
    name: def.name,
    outputs: def.outputs,
    config: def.config,
  } as Trigger<O, C>
}
```

- [ ] **Step 3: Run defineTrigger tests**

Run: `pnpm --filter @cozy/runtime test src/define-trigger.test.ts`
Expected: 2 tests pass.

- [ ] **Step 4: Write defineConfig failing test**

Write `packages/runtime/src/define-config.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { defineConfig } from "./define-config.js"

describe("defineConfig", () => {
  it("preserves the config object", () => {
    const config = defineConfig({
      target: "hono",
      services: {
        db: { connect: () => "fake" },
        logger: (ctx) => ({ id: ctx.requestId, info: () => {} }),
      },
    })
    expect(config.target).toBe("hono")
    expect(config.services.db).toBeDefined()
    expect(typeof config.services.logger).toBe("function")
  })

  it("rejects unknown target at compile time", () => {
    // This block is a *type test* only. Uncommenting it should produce a TS error.
    // defineConfig({ target: "express", services: {} })
  })
})
```

- [ ] **Step 5: Write src/define-config.ts**

Write `packages/runtime/src/define-config.ts`:

```ts
import type { WorkflowConfig } from "./types.js"

export function defineConfig(config: WorkflowConfig): WorkflowConfig {
  return config
}
```

- [ ] **Step 6: Run defineConfig tests**

Run: `pnpm --filter @cozy/runtime test src/define-config.test.ts`
Expected: 2 tests pass.

- [ ] **Step 7: Re-export from index**

Edit `packages/runtime/src/index.ts`:

```ts
export { defineConfig } from "./define-config.js"
export { defineNode } from "./define-node.js"
export { defineTrigger } from "./define-trigger.js"
export type { DefineNodeInput } from "./define-node.js"
export type { DefineTriggerInput } from "./define-trigger.js"
```

- [ ] **Step 8: Commit**

```bash
git add packages/runtime/src/define-trigger.ts packages/runtime/src/define-trigger.test.ts \
        packages/runtime/src/define-config.ts packages/runtime/src/define-config.test.ts \
        packages/runtime/src/index.ts
git commit -m "feat(runtime): defineTrigger and defineConfig helpers"
```

---

## Task 6: Workflow file types and reference parsing

**Files:**
- Create: `packages/runtime/src/workflow/types.ts`
- Create: `packages/runtime/src/workflow/reference.ts`
- Create: `packages/runtime/src/workflow/reference.test.ts`

- [ ] **Step 1: Write workflow types**

Write `packages/runtime/src/workflow/types.ts`:

```ts
export interface WorkflowFile {
  cozy: 1
  nodes: Record<string, NodeInstance>
  view?: Record<string, NodeView>
}

export interface NodeInstance {
  uses: string
  in?: Record<string, unknown>     // values can be reference strings or literals or {$literal: ...}
  config?: Record<string, unknown>
  after?: string[]
  label?: string
}

export interface NodeView {
  x: number
  y: number
}

/**
 * Parsed reference. Source nodes are split into instance id + path of property keys.
 * "request.body.email"  ->  { nodeId: "request", path: ["body", "email"] }
 * "parseBody"            ->  { nodeId: "parseBody", path: [] }
 */
export interface ParsedReference {
  nodeId: string
  path: string[]
}

/**
 * A resolved input value: either a reference (to be looked up at run time) or a literal.
 */
export type ResolvedInputValue =
  | { kind: "reference"; ref: ParsedReference }
  | { kind: "literal"; value: unknown }
```

- [ ] **Step 2: Write failing reference test**

Write `packages/runtime/src/workflow/reference.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { parseReference, resolveInputValue } from "./reference.js"

describe("parseReference", () => {
  it("parses a single identifier as nodeId with empty path", () => {
    expect(parseReference("request")).toEqual({ nodeId: "request", path: [] })
  })

  it("parses a dotted path", () => {
    expect(parseReference("request.body.email")).toEqual({
      nodeId: "request",
      path: ["body", "email"],
    })
  })

  it("rejects invalid identifiers", () => {
    expect(parseReference("123abc")).toBeNull()
    expect(parseReference("foo bar")).toBeNull()
    expect(parseReference("")).toBeNull()
    expect(parseReference("foo..bar")).toBeNull()
  })

  it("accepts identifiers with $ and _", () => {
    expect(parseReference("$root.user_id")).toEqual({
      nodeId: "$root",
      path: ["user_id"],
    })
  })
})

describe("resolveInputValue", () => {
  it("treats valid reference strings as references", () => {
    expect(resolveInputValue("parseBody.email")).toEqual({
      kind: "reference",
      ref: { nodeId: "parseBody", path: ["email"] },
    })
  })

  it("treats non-reference strings as literals", () => {
    expect(resolveInputValue("hello world")).toEqual({
      kind: "literal",
      value: "hello world",
    })
  })

  it("treats numbers, booleans, and arrays as literals", () => {
    expect(resolveInputValue(201)).toEqual({ kind: "literal", value: 201 })
    expect(resolveInputValue(true)).toEqual({ kind: "literal", value: true })
    expect(resolveInputValue([1, 2, 3])).toEqual({ kind: "literal", value: [1, 2, 3] })
  })

  it("treats nested objects as literals (NOT recursively scanned for refs)", () => {
    expect(resolveInputValue({ a: 1, b: "x" })).toEqual({
      kind: "literal",
      value: { a: 1, b: "x" },
    })
  })

  it("unwraps {$literal: ...} into a plain literal", () => {
    expect(resolveInputValue({ $literal: "parseBody" })).toEqual({
      kind: "literal",
      value: "parseBody",
    })
    expect(resolveInputValue({ $literal: { nested: 1 } })).toEqual({
      kind: "literal",
      value: { nested: 1 },
    })
  })
})
```

- [ ] **Step 3: Run test to verify failure**

Run: `pnpm --filter @cozy/runtime test src/workflow/reference.test.ts`
Expected: import error — `reference.ts` doesn't exist.

- [ ] **Step 4: Write reference.ts**

Write `packages/runtime/src/workflow/reference.ts`:

```ts
import type { ParsedReference, ResolvedInputValue } from "./types.js"

const IDENT = /^[a-zA-Z_$][\w$]*$/
const REFERENCE = /^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*$/

/**
 * Parses a reference string of the form "nodeId" or "nodeId.path.to.field".
 * Returns null if the input doesn't match the reference grammar.
 */
export function parseReference(input: string): ParsedReference | null {
  if (!REFERENCE.test(input)) return null
  const [nodeId, ...path] = input.split(".")
  if (!nodeId || !IDENT.test(nodeId)) return null
  for (const seg of path) {
    if (!IDENT.test(seg)) return null
  }
  return { nodeId, path }
}

/**
 * Decides whether an `in` value is a reference (to resolve at runtime) or a literal.
 * Strings that match the reference grammar are references; everything else is a literal.
 * The {$literal: x} escape wraps literal values that would otherwise be parsed as references.
 */
export function resolveInputValue(value: unknown): ResolvedInputValue {
  // Explicit literal escape: { $literal: <anything> } unwraps to literal.
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "$literal" in value &&
    Object.keys(value as object).length === 1
  ) {
    return { kind: "literal", value: (value as { $literal: unknown }).$literal }
  }

  if (typeof value === "string") {
    const ref = parseReference(value)
    if (ref) return { kind: "reference", ref }
  }

  return { kind: "literal", value }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @cozy/runtime test src/workflow/reference.test.ts`
Expected: all reference tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/workflow/types.ts \
        packages/runtime/src/workflow/reference.ts \
        packages/runtime/src/workflow/reference.test.ts
git commit -m "feat(runtime): reference parsing and literal-vs-reference resolution"
```

---

## Task 7: Workflow file schema and parser

**Files:**
- Create: `packages/runtime/src/workflow/schema.ts`
- Create: `packages/runtime/src/workflow/parse.ts`
- Create: `packages/runtime/src/workflow/parse.test.ts`

- [ ] **Step 1: Write the workflow JSON schema**

Write `packages/runtime/src/workflow/schema.ts`:

```ts
import { z } from "zod"

export const NodeInstanceSchema = z.object({
  uses: z.string().min(1),
  in: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  after: z.array(z.string()).optional(),
  label: z.string().optional(),
})

export const NodeViewSchema = z.object({
  x: z.number(),
  y: z.number(),
})

export const WorkflowFileSchema = z.object({
  cozy: z.literal(1),
  nodes: z.record(z.string(), NodeInstanceSchema),
  view: z.record(z.string(), NodeViewSchema).optional(),
})
```

- [ ] **Step 2: Write failing parse test**

Write `packages/runtime/src/workflow/parse.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { parseWorkflow } from "./parse.js"

describe("parseWorkflow", () => {
  it("parses a minimal workflow", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        request: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        response: { uses: "@core/response", in: { body: "request.params" } },
      },
    })
    expect(wf.nodes.request.uses).toBe("@core/http-request")
    expect(wf.nodes.response.in?.body).toBe("request.params")
  })

  it("rejects unknown version", () => {
    expect(() =>
      parseWorkflow({ cozy: 99, nodes: {} } as unknown),
    ).toThrow(/cozy.*version/i)
  })

  it("rejects when nodes is missing", () => {
    expect(() => parseWorkflow({ cozy: 1 } as unknown)).toThrow()
  })

  it("rejects a node without `uses`", () => {
    expect(() =>
      parseWorkflow({ cozy: 1, nodes: { x: {} as never } } as unknown),
    ).toThrow(/uses/)
  })

  it("accepts optional view block", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: { r: { uses: "@core/response" } },
      view: { r: { x: 10, y: 20 } },
    })
    expect(wf.view?.r).toEqual({ x: 10, y: 20 })
  })
})
```

- [ ] **Step 3: Run test to verify failure**

Run: `pnpm --filter @cozy/runtime test src/workflow/parse.test.ts`
Expected: import error — `parse.ts` doesn't exist.

- [ ] **Step 4: Write parse.ts**

Write `packages/runtime/src/workflow/parse.ts`:

```ts
import { z } from "zod"
import { WorkflowFileSchema } from "./schema.js"
import type { WorkflowFile } from "./types.js"

export class WorkflowParseError extends Error {
  constructor(
    message: string,
    public readonly issues?: z.ZodIssue[],
  ) {
    super(message)
    this.name = "WorkflowParseError"
  }
}

export function parseWorkflow(input: unknown): WorkflowFile {
  const result = WorkflowFileSchema.safeParse(input)
  if (!result.success) {
    const versionIssue = result.error.issues.find(
      (i) => i.path[0] === "cozy" && i.code === "invalid_literal",
    )
    if (versionIssue) {
      throw new WorkflowParseError(
        `Unsupported workflow format version. This runtime expects \`cozy: 1\`.`,
        result.error.issues,
      )
    }
    throw new WorkflowParseError(
      `Invalid workflow file:\n${result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
      result.error.issues,
    )
  }
  return result.data
}

/**
 * Parses a workflow from a JSON string. Throws WorkflowParseError on either
 * JSON syntax or schema validation failures.
 */
export function parseWorkflowFromString(source: string): WorkflowFile {
  let json: unknown
  try {
    json = JSON.parse(source)
  } catch (e) {
    throw new WorkflowParseError(`Invalid JSON: ${(e as Error).message}`)
  }
  return parseWorkflow(json)
}
```

- [ ] **Step 5: Run test to verify pass**

Run: `pnpm --filter @cozy/runtime test src/workflow/parse.test.ts`
Expected: all parse tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/workflow/schema.ts \
        packages/runtime/src/workflow/parse.ts \
        packages/runtime/src/workflow/parse.test.ts
git commit -m "feat(runtime): workflow file Zod schema + parser with friendly errors"
```

---

## Task 8: Workflow validation (references, cycles)

**Files:**
- Create: `packages/runtime/src/workflow/validate.ts`
- Create: `packages/runtime/src/workflow/validate.test.ts`

- [ ] **Step 1: Write failing validation test**

Write `packages/runtime/src/workflow/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { parseWorkflow } from "./parse.js"
import { validateWorkflow } from "./validate.js"

describe("validateWorkflow", () => {
  it("accepts a valid workflow", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        request: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        response: { uses: "@core/response", in: { body: "request.body" } },
      },
    })
    const result = validateWorkflow(wf)
    expect(result.errors).toEqual([])
  })

  it("rejects references to unknown nodes", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        response: { uses: "@core/response", in: { body: "nonexistent.value" } },
      },
    })
    const result = validateWorkflow(wf)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toMatch(/nonexistent/)
  })

  it("rejects after-references to unknown nodes", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        a: { uses: "@core/response", after: ["missing"] },
      },
    })
    const result = validateWorkflow(wf)
    expect(result.errors.some((e) => /missing/.test(e.message))).toBe(true)
  })

  it("detects direct cycles", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        a: { uses: "./n", in: { x: "b.y" } },
        b: { uses: "./n", in: { y: "a.x" } },
      },
    })
    const result = validateWorkflow(wf)
    expect(result.errors.some((e) => /cycle/i.test(e.message))).toBe(true)
  })

  it("detects cycles through `after`", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        a: { uses: "./n", after: ["b"] },
        b: { uses: "./n", after: ["a"] },
      },
    })
    const result = validateWorkflow(wf)
    expect(result.errors.some((e) => /cycle/i.test(e.message))).toBe(true)
  })

  it("allows multi-incoming dependencies (joins)", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        a: { uses: "./n", in: { v: "req.body" } },
        b: { uses: "./n", in: { v: "req.body" } },
        join: { uses: "./n", in: { x: "a.out", y: "b.out" } },
      },
    })
    const result = validateWorkflow(wf)
    expect(result.errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @cozy/runtime test src/workflow/validate.test.ts`
Expected: import error.

- [ ] **Step 3: Write validate.ts**

Write `packages/runtime/src/workflow/validate.ts`:

```ts
import { resolveInputValue } from "./reference.js"
import type { WorkflowFile } from "./types.js"

export interface ValidationError {
  nodeId: string
  field: string
  message: string
}

export interface ValidationResult {
  errors: ValidationError[]
  /** Adjacency: dependencies of each node (referenced nodes + after listings). */
  depsByNode: Map<string, Set<string>>
}

export function validateWorkflow(wf: WorkflowFile): ValidationResult {
  const errors: ValidationError[] = []
  const depsByNode = new Map<string, Set<string>>()

  for (const [nodeId, instance] of Object.entries(wf.nodes)) {
    const deps = new Set<string>()
    depsByNode.set(nodeId, deps)

    // Resolve references in `in` block
    if (instance.in) {
      for (const [field, raw] of Object.entries(instance.in)) {
        const resolved = resolveInputValue(raw)
        if (resolved.kind === "reference") {
          if (!wf.nodes[resolved.ref.nodeId]) {
            errors.push({
              nodeId,
              field,
              message: `references unknown node \`${resolved.ref.nodeId}\``,
            })
          } else {
            deps.add(resolved.ref.nodeId)
          }
        }
      }
    }

    // After constraints
    if (instance.after) {
      for (const target of instance.after) {
        if (!wf.nodes[target]) {
          errors.push({
            nodeId,
            field: "after",
            message: `references unknown node \`${target}\` in after[]`,
          })
        } else {
          deps.add(target)
        }
      }
    }
  }

  // Cycle detection — DFS with coloring
  if (errors.length === 0) {
    const WHITE = 0
    const GRAY = 1
    const BLACK = 2
    const color = new Map<string, number>()
    for (const id of Object.keys(wf.nodes)) color.set(id, WHITE)

    const visit = (id: string, stack: string[]): boolean => {
      const c = color.get(id) ?? WHITE
      if (c === GRAY) {
        const cycleStart = stack.indexOf(id)
        const cycle = stack.slice(cycleStart).concat(id)
        errors.push({
          nodeId: id,
          field: "in",
          message: `cycle detected: ${cycle.join(" -> ")}`,
        })
        return true
      }
      if (c === BLACK) return false
      color.set(id, GRAY)
      stack.push(id)
      for (const dep of depsByNode.get(id) ?? []) {
        if (visit(dep, stack)) return true
      }
      stack.pop()
      color.set(id, BLACK)
      return false
    }

    for (const id of Object.keys(wf.nodes)) {
      if (visit(id, [])) break
    }
  }

  return { errors, depsByNode }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @cozy/runtime test src/workflow/validate.test.ts`
Expected: all validation tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/workflow/validate.ts packages/runtime/src/workflow/validate.test.ts
git commit -m "feat(runtime): workflow validation (refs resolve, after resolves, no cycles)"
```

---

## Task 9: Topology and parallel groups

**Files:**
- Create: `packages/runtime/src/exec/topology.ts`
- Create: `packages/runtime/src/exec/topology.test.ts`

- [ ] **Step 1: Write failing topology test**

Write `packages/runtime/src/exec/topology.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { parseWorkflow } from "../workflow/parse.js"
import { validateWorkflow } from "../workflow/validate.js"
import { computeExecutionPlan } from "./topology.js"

describe("computeExecutionPlan", () => {
  it("groups nodes by dependency wave", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        a: { uses: "./n", in: { v: "req.body" } },
        b: { uses: "./n", in: { v: "req.body" } },
        join: { uses: "./n", in: { x: "a.out", y: "b.out" } },
        res: { uses: "@core/response", in: { body: "join.out" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)
    expect(plan.waves).toEqual([
      ["req"],
      ["a", "b"],   // parallel
      ["join"],
      ["res"],
    ])
  })

  it("groups all independent triggers in wave 0", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        getReq: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        postReq: { uses: "@core/http-request", config: { path: "/x", method: "POST" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)
    expect(plan.waves[0]?.sort()).toEqual(["getReq", "postReq"])
  })

  it("returns reachable-from-trigger node sets", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        getReq: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        postReq: { uses: "@core/http-request", config: { path: "/x", method: "POST" } },
        getOnly: { uses: "./n", in: { v: "getReq.body" } },
        postOnly: { uses: "./n", in: { v: "postReq.body" } },
        getRes: { uses: "@core/response", in: { body: "getOnly.out" } },
        postRes: { uses: "@core/response", in: { body: "postOnly.out" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)
    expect(plan.reachableFrom.get("getReq")).toEqual(new Set(["getReq", "getOnly", "getRes"]))
    expect(plan.reachableFrom.get("postReq")).toEqual(new Set(["postReq", "postOnly", "postRes"]))
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @cozy/runtime test src/exec/topology.test.ts`
Expected: import error.

- [ ] **Step 3: Write topology.ts**

Write `packages/runtime/src/exec/topology.ts`:

```ts
import type { WorkflowFile } from "../workflow/types.js"

export interface ExecutionPlan {
  /** Topological waves: every node in waves[i] can fire in parallel once waves[0..i-1] are done. */
  waves: string[][]
  /** For each trigger node, the set of nodes reachable forward (including the trigger itself). */
  reachableFrom: Map<string, Set<string>>
}

export function computeExecutionPlan(
  wf: WorkflowFile,
  depsByNode: Map<string, Set<string>>,
): ExecutionPlan {
  const allIds = Object.keys(wf.nodes)
  const remaining = new Map<string, Set<string>>()
  for (const id of allIds) {
    remaining.set(id, new Set(depsByNode.get(id) ?? []))
  }

  const waves: string[][] = []
  while (remaining.size > 0) {
    const wave: string[] = []
    for (const [id, deps] of remaining) {
      if (deps.size === 0) wave.push(id)
    }
    if (wave.length === 0) {
      throw new Error("computeExecutionPlan: stuck — possible cycle (validate first)")
    }
    waves.push(wave.sort())
    for (const id of wave) {
      remaining.delete(id)
      for (const deps of remaining.values()) {
        deps.delete(id)
      }
    }
  }

  // Reachable-from: BFS forward from each trigger node.
  const downstreamOf = new Map<string, Set<string>>()
  for (const id of allIds) downstreamOf.set(id, new Set())
  for (const [id, deps] of depsByNode) {
    for (const dep of deps) {
      downstreamOf.get(dep)?.add(id)
    }
  }

  const reachableFrom = new Map<string, Set<string>>()
  for (const id of allIds) {
    if (wf.nodes[id]?.uses.startsWith("@core/http-request")) {
      const reachable = new Set<string>([id])
      const queue: string[] = [id]
      while (queue.length > 0) {
        const cur = queue.shift()!
        for (const next of downstreamOf.get(cur) ?? []) {
          if (!reachable.has(next)) {
            reachable.add(next)
            queue.push(next)
          }
        }
      }
      reachableFrom.set(id, reachable)
    }
  }

  return { waves, reachableFrom }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @cozy/runtime test src/exec/topology.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/exec/topology.ts packages/runtime/src/exec/topology.test.ts
git commit -m "feat(runtime): execution plan computation — topological waves + per-trigger reachable sets"
```

---

## Task 10: Lifecycle event emitter

**Files:**
- Create: `packages/runtime/src/exec/lifecycle.ts`
- Create: `packages/runtime/src/exec/lifecycle.test.ts`

- [ ] **Step 1: Write failing lifecycle test**

Write `packages/runtime/src/exec/lifecycle.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { LifecycleEmitter } from "./lifecycle.js"

describe("LifecycleEmitter", () => {
  it("calls subscribers when events fire", () => {
    const emitter = new LifecycleEmitter()
    const onBefore = vi.fn()
    emitter.on("before-node", onBefore)
    emitter.emit({ type: "before-node", nodeId: "n1", input: { a: 1 } })
    expect(onBefore).toHaveBeenCalledWith({ type: "before-node", nodeId: "n1", input: { a: 1 } })
  })

  it("supports multiple subscribers per event", () => {
    const emitter = new LifecycleEmitter()
    const s1 = vi.fn()
    const s2 = vi.fn()
    emitter.on("after-node", s1)
    emitter.on("after-node", s2)
    emitter.emit({ type: "after-node", nodeId: "n", output: {}, durationMs: 5 })
    expect(s1).toHaveBeenCalledOnce()
    expect(s2).toHaveBeenCalledOnce()
  })

  it("unsubscribe stops further events", () => {
    const emitter = new LifecycleEmitter()
    const handler = vi.fn()
    const off = emitter.on("complete", handler)
    off()
    emitter.emit({ type: "complete", totalMs: 1 })
    expect(handler).not.toHaveBeenCalled()
  })

  it("a subscriber error does not stop other subscribers", () => {
    const emitter = new LifecycleEmitter()
    const throwing = vi.fn(() => {
      throw new Error("boom")
    })
    const ok = vi.fn()
    emitter.on("before-node", throwing)
    emitter.on("before-node", ok)
    emitter.emit({ type: "before-node", nodeId: "x", input: {} })
    expect(ok).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @cozy/runtime test src/exec/lifecycle.test.ts`
Expected: import error.

- [ ] **Step 3: Write lifecycle.ts**

Write `packages/runtime/src/exec/lifecycle.ts`:

```ts
export type LifecycleEvent =
  | { type: "before-node"; nodeId: string; input: Record<string, unknown> }
  | { type: "after-node"; nodeId: string; output: Record<string, unknown>; durationMs: number }
  | { type: "edge-fired"; from: string; to: string; value: unknown }
  | { type: "error"; nodeId: string; error: Error }
  | { type: "complete"; totalMs: number }

export type LifecycleEventType = LifecycleEvent["type"]

type Handler<T extends LifecycleEventType> = (ev: Extract<LifecycleEvent, { type: T }>) => void

export class LifecycleEmitter {
  private handlers = new Map<LifecycleEventType, Set<Handler<LifecycleEventType>>>()

  on<T extends LifecycleEventType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler as Handler<LifecycleEventType>)
    return () => set?.delete(handler as Handler<LifecycleEventType>)
  }

  emit(event: LifecycleEvent): void {
    const set = this.handlers.get(event.type)
    if (!set) return
    for (const handler of set) {
      try {
        handler(event as Parameters<typeof handler>[0])
      } catch {
        // Subscribers must not break other subscribers or the workflow.
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @cozy/runtime test src/exec/lifecycle.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/exec/lifecycle.ts packages/runtime/src/exec/lifecycle.test.ts
git commit -m "feat(runtime): lifecycle event emitter for interpreter introspection"
```

---

## Task 11: Service resolution

**Files:**
- Create: `packages/runtime/src/services/types.ts`
- Create: `packages/runtime/src/services/resolve.ts`
- Create: `packages/runtime/src/services/dispose.ts`
- Create: `packages/runtime/src/services/resolve.test.ts`

- [ ] **Step 1: Write services types**

Write `packages/runtime/src/services/types.ts`:

```ts
import type { ServiceContext, ServiceValue, WorkflowConfig } from "../types.js"

export type ResolvedServices = Record<string, unknown>

export interface ServiceResolver {
  /** Resolves the services bag for a single workflow run. Calls factories once. */
  resolve(ctx: ServiceContext): Promise<ResolvedServices>
}

export type ServicesConfig = WorkflowConfig["services"]
export type { ServiceContext, ServiceValue }
```

- [ ] **Step 2: Write failing resolve test**

Write `packages/runtime/src/services/resolve.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createServiceResolver } from "./resolve.js"
import { disposeServices } from "./dispose.js"

describe("createServiceResolver", () => {
  it("returns plain values as-is", async () => {
    const r = createServiceResolver({ db: { kind: "db" } })
    const resolved = await r.resolve({ requestId: "1", timestamp: 0 })
    expect(resolved.db).toEqual({ kind: "db" })
  })

  it("calls factories with the context", async () => {
    const factory = vi.fn((ctx: { requestId: string }) => ({ id: ctx.requestId }))
    const r = createServiceResolver({ logger: factory })
    const resolved = await r.resolve({ requestId: "abc", timestamp: 1 })
    expect(factory).toHaveBeenCalledOnce()
    expect(resolved.logger).toEqual({ id: "abc" })
  })

  it("singletons reuse the same instance across resolve() calls", async () => {
    const value = { shared: true }
    const r = createServiceResolver({ db: value })
    const r1 = await r.resolve({ requestId: "1", timestamp: 0 })
    const r2 = await r.resolve({ requestId: "2", timestamp: 0 })
    expect(r1.db).toBe(r2.db)
  })

  it("factories return a fresh instance per call", async () => {
    let counter = 0
    const r = createServiceResolver({ logger: () => ({ n: ++counter }) })
    const r1 = await r.resolve({ requestId: "1", timestamp: 0 })
    const r2 = await r.resolve({ requestId: "2", timestamp: 0 })
    expect(r1.logger).not.toBe(r2.logger)
    expect((r1.logger as { n: number }).n).toBe(1)
    expect((r2.logger as { n: number }).n).toBe(2)
  })

  it("awaits async factories", async () => {
    const r = createServiceResolver({
      logger: async (ctx) => ({ id: ctx.requestId }),
    })
    const resolved = await r.resolve({ requestId: "x", timestamp: 0 })
    expect(resolved.logger).toEqual({ id: "x" })
  })
})

describe("disposeServices", () => {
  it("calls dispose() on each disposable", async () => {
    const disposeA = vi.fn()
    const disposeB = vi.fn()
    await disposeServices({ a: { dispose: disposeA }, b: { dispose: disposeB }, c: {} })
    expect(disposeA).toHaveBeenCalledOnce()
    expect(disposeB).toHaveBeenCalledOnce()
  })

  it("awaits async dispose()", async () => {
    let done = false
    await disposeServices({
      a: { dispose: async () => { await new Promise((r) => setTimeout(r, 5)); done = true } },
    })
    expect(done).toBe(true)
  })

  it("one dispose() throw does not skip the others", async () => {
    const okDispose = vi.fn()
    await disposeServices({
      bad: { dispose: () => { throw new Error("nope") } },
      ok: { dispose: okDispose },
    })
    expect(okDispose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 3: Run test to verify failure**

Run: `pnpm --filter @cozy/runtime test src/services/`
Expected: import errors.

- [ ] **Step 4: Write resolve.ts**

Write `packages/runtime/src/services/resolve.ts`:

```ts
import type { ServiceContext } from "../types.js"
import type { ResolvedServices, ServiceResolver, ServicesConfig } from "./types.js"

export function createServiceResolver(services: ServicesConfig): ServiceResolver {
  return {
    async resolve(ctx: ServiceContext): Promise<ResolvedServices> {
      const resolved: ResolvedServices = {}
      for (const [name, value] of Object.entries(services)) {
        if (typeof value === "function") {
          resolved[name] = await (value as (c: ServiceContext) => unknown)(ctx)
        } else {
          resolved[name] = value
        }
      }
      return resolved
    },
  }
}
```

- [ ] **Step 5: Write dispose.ts**

Write `packages/runtime/src/services/dispose.ts`:

```ts
import type { ResolvedServices } from "./types.js"

interface MaybeDisposable {
  dispose?: () => void | Promise<void>
}

export async function disposeServices(resolved: ResolvedServices): Promise<void> {
  const tasks: Promise<unknown>[] = []
  for (const value of Object.values(resolved)) {
    if (value && typeof value === "object" && "dispose" in value) {
      const d = (value as MaybeDisposable).dispose
      if (typeof d === "function") {
        tasks.push(Promise.resolve(d.call(value)).catch(() => {}))
      }
    }
  }
  await Promise.all(tasks)
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm --filter @cozy/runtime test src/services/`
Expected: all 8 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/services/
git commit -m "feat(runtime): service resolver (singletons/factories) and disposeServices"
```

---

## Task 12: Built-in nodes — @core/http-request and @core/response

**Files:**
- Create: `packages/runtime/src/core/http-request.ts`
- Create: `packages/runtime/src/core/response.ts`
- Create: `packages/runtime/src/core/registry.ts`
- Create: `packages/runtime/src/core/registry.test.ts`

- [ ] **Step 1: Write http-request.ts**

Write `packages/runtime/src/core/http-request.ts`:

```ts
import { z } from "zod"
import { defineTrigger } from "../define-trigger.js"

/**
 * Built-in HTTP request trigger. v1 supports JSON bodies; non-JSON is exposed as raw text.
 * Path/method config drives route registration in the dev server / codegen.
 */
export default defineTrigger({
  name: "HTTP Request",
  config: z.object({
    path: z.string().describe("Route path, e.g. /users/:id").default("{workflow_path}"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).default("GET"),
  }),
  outputs: z.object({
    body: z.unknown(),
    params: z.record(z.string(), z.string()),
    query: z.record(z.string(), z.string()),
    headers: z.record(z.string(), z.string()),
    context: z.object({
      requestId: z.string(),
      timestamp: z.number(),
    }),
  }),
})
```

- [ ] **Step 2: Write response.ts**

Write `packages/runtime/src/core/response.ts`:

```ts
import { z } from "zod"
import { defineNode } from "../define-node.js"

/**
 * Built-in response terminator. When this node fires, the workflow run completes
 * and the host (Hono in v1) sends the response.
 */
export default defineNode({
  name: "Response",
  inputs: z.object({
    body: z.unknown(),
    status: z.number().int().min(100).max(599).optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  outputs: z.object({
    sent: z.boolean(),
  }),
  async run({ body, status, headers }) {
    // The runner intercepts @core/response before reaching here normally —
    // it reads the input to construct the HTTP response. We still execute the body so
    // that direct programmatic calls (in tests) get a meaningful return value.
    void body
    void status
    void headers
    return { sent: true }
  },
})
```

- [ ] **Step 3: Write registry.ts**

Write `packages/runtime/src/core/registry.ts`:

```ts
import type { AnyNodeOrTrigger } from "../types.js"
import httpRequest from "./http-request.js"
import response from "./response.js"

const CORE_REGISTRY: Record<string, AnyNodeOrTrigger> = {
  "@core/http-request": httpRequest,
  "@core/response": response,
}

export function resolveCoreNode(uses: string): AnyNodeOrTrigger | null {
  return CORE_REGISTRY[uses] ?? null
}

export function isCoreReference(uses: string): boolean {
  return uses.startsWith("@core/")
}

export const CORE_NODE_IDS = Object.keys(CORE_REGISTRY)
```

- [ ] **Step 4: Write registry tests**

Write `packages/runtime/src/core/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { CORE_NODE_IDS, isCoreReference, resolveCoreNode } from "./registry.js"

describe("core node registry", () => {
  it("exposes http-request and response", () => {
    expect(CORE_NODE_IDS).toEqual(
      expect.arrayContaining(["@core/http-request", "@core/response"]),
    )
  })

  it("isCoreReference matches @core/* uses", () => {
    expect(isCoreReference("@core/http-request")).toBe(true)
    expect(isCoreReference("./nodes/foo")).toBe(false)
  })

  it("resolveCoreNode returns the trigger object", () => {
    const t = resolveCoreNode("@core/http-request")
    expect(t?.kind).toBe("trigger")
  })

  it("resolveCoreNode returns null for unknown core ids", () => {
    expect(resolveCoreNode("@core/nonexistent")).toBeNull()
  })

  it("@core/http-request defaults path to {workflow_path}", () => {
    const t = resolveCoreNode("@core/http-request")
    if (!t || t.kind !== "trigger" || !t.config) throw new Error("trigger has no config")
    const parsed = t.config.parse({})
    expect(parsed.path).toBe("{workflow_path}")
    expect(parsed.method).toBe("GET")
  })
})
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @cozy/runtime test src/core/`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/core/
git commit -m "feat(runtime): @core/http-request and @core/response built-ins + registry"
```

---

## Task 13: Workflow runner — the interpreter

**Files:**
- Create: `packages/runtime/src/exec/errors.ts`
- Create: `packages/runtime/src/exec/run.ts`
- Create: `packages/runtime/src/exec/run.test.ts`

- [ ] **Step 1: Write errors.ts**

Write `packages/runtime/src/exec/errors.ts`:

```ts
export class WorkflowError extends Error {
  constructor(
    message: string,
    public readonly nodeId: string | null,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = "WorkflowError"
  }
}

export class NodeRunError extends WorkflowError {
  constructor(nodeId: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause)
    super(`Node \`${nodeId}\` failed: ${msg}`, nodeId, cause)
    this.name = "NodeRunError"
  }
}
```

- [ ] **Step 2: Write failing runner test**

Write `packages/runtime/src/exec/run.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { resolveCoreNode } from "../core/registry.js"
import { LifecycleEmitter } from "./lifecycle.js"
import { runWorkflow } from "./run.js"
import { parseWorkflow } from "../workflow/parse.js"
import { validateWorkflow } from "../workflow/validate.js"
import { computeExecutionPlan } from "./topology.js"

function setupSimpleAdd() {
  const add = defineNode({
    name: "Add",
    inputs: z.object({ a: z.number(), b: z.number() }),
    outputs: z.object({ sum: z.number() }),
    async run({ a, b }) {
      return { sum: a + b }
    },
  })
  return add
}

describe("runWorkflow", () => {
  it("executes a single trigger -> compute -> response chain", async () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/add", method: "POST" } },
        add: { uses: "./add", in: { a: "req.body.a", b: "req.body.b" } },
        res: { uses: "@core/response", in: { body: "add.sum", status: 200 } },
      },
    })
    const { errors, depsByNode } = validateWorkflow(wf)
    expect(errors).toEqual([])
    const plan = computeExecutionPlan(wf, depsByNode)

    const userNodes: Record<string, ReturnType<typeof setupSimpleAdd>> = {
      "./add": setupSimpleAdd(),
    }

    const result = await runWorkflow({
      workflow: wf,
      plan,
      triggerNodeId: "req",
      triggerOutputs: {
        body: { a: 2, b: 3 },
        params: {},
        query: {},
        headers: {},
        context: { requestId: "x", timestamp: 0 },
      },
      services: {},
      resolveNode: (uses) => resolveCoreNode(uses) ?? userNodes[uses] ?? null,
    })

    expect(result.status).toBe(200)
    expect(result.body).toBe(5)
  })

  it("runs independent branches in parallel and joins them", async () => {
    const A = vi.fn(async () => ({ out: "A" }))
    const B = vi.fn(async () => ({ out: "B" }))
    const join = vi.fn(async ({ a, b }: { a: string; b: string }) => ({ joined: `${a}+${b}` }))

    const nA = defineNode({
      inputs: z.object({}),
      outputs: z.object({ out: z.string() }),
      run: A as never,
    })
    const nB = defineNode({
      inputs: z.object({}),
      outputs: z.object({ out: z.string() }),
      run: B as never,
    })
    const nJoin = defineNode({
      inputs: z.object({ a: z.string(), b: z.string() }),
      outputs: z.object({ joined: z.string() }),
      run: join as never,
    })

    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        a: { uses: "./a", in: {} },
        b: { uses: "./b", in: {} },
        j: { uses: "./join", in: { a: "a.out", b: "b.out" }, after: ["req"] },
        r: { uses: "@core/response", in: { body: "j.joined" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)
    const userNodes = { "./a": nA, "./b": nB, "./join": nJoin }

    const result = await runWorkflow({
      workflow: wf,
      plan,
      triggerNodeId: "req",
      triggerOutputs: { body: null, params: {}, query: {}, headers: {}, context: { requestId: "", timestamp: 0 } },
      services: {},
      resolveNode: (uses) => resolveCoreNode(uses) ?? (userNodes as Record<string, unknown>)[uses] as never ?? null,
    })

    expect(result.body).toBe("A+B")
    expect(A).toHaveBeenCalled()
    expect(B).toHaveBeenCalled()
  })

  it("emits before-node and after-node events for each node", async () => {
    const emitter = new LifecycleEmitter()
    const events: string[] = []
    emitter.on("before-node", (e) => events.push(`before:${e.nodeId}`))
    emitter.on("after-node", (e) => events.push(`after:${e.nodeId}`))

    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/", method: "GET" } },
        res: { uses: "@core/response", in: { body: "req.body" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)

    await runWorkflow({
      workflow: wf,
      plan,
      triggerNodeId: "req",
      triggerOutputs: { body: "hi", params: {}, query: {}, headers: {}, context: { requestId: "", timestamp: 0 } },
      services: {},
      resolveNode: (u) => resolveCoreNode(u),
      lifecycle: emitter,
    })

    expect(events).toContain("before:req")
    expect(events).toContain("after:req")
    expect(events).toContain("before:res")
    expect(events).toContain("after:res")
  })

  it("fail-fast: a node throw aborts the workflow with NodeRunError", async () => {
    const boom = defineNode({
      inputs: z.object({}),
      outputs: z.object({}),
      async run() {
        throw new Error("boom")
      },
    })
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/", method: "GET" } },
        b: { uses: "./boom", in: {} },
        r: { uses: "@core/response", in: { body: "b" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)

    await expect(
      runWorkflow({
        workflow: wf,
        plan,
        triggerNodeId: "req",
        triggerOutputs: { body: null, params: {}, query: {}, headers: {}, context: { requestId: "", timestamp: 0 } },
        services: {},
        resolveNode: (u) => resolveCoreNode(u) ?? { "./boom": boom }[u] ?? null,
      }),
    ).rejects.toThrow(/boom/)
  })
})
```

- [ ] **Step 3: Run test to verify failure**

Run: `pnpm --filter @cozy/runtime test src/exec/run.test.ts`
Expected: import error — `run.ts` doesn't exist.

- [ ] **Step 4: Write run.ts**

Write `packages/runtime/src/exec/run.ts`:

```ts
import type { AnyNodeOrTrigger, Node, Services } from "../types.js"
import { resolveInputValue } from "../workflow/reference.js"
import type { WorkflowFile } from "../workflow/types.js"
import { NodeRunError } from "./errors.js"
import type { LifecycleEmitter } from "./lifecycle.js"
import type { ExecutionPlan } from "./topology.js"

export interface WorkflowRunResult {
  status: number
  body: unknown
  headers: Record<string, string>
}

export interface RunWorkflowOptions {
  workflow: WorkflowFile
  plan: ExecutionPlan
  /** Which trigger node fired this run. */
  triggerNodeId: string
  /** The outputs of the trigger node, pre-resolved by the host (HTTP request data, etc.). */
  triggerOutputs: Record<string, unknown>
  services: Services
  /** Maps a node's `uses` string to its Node/Trigger object. */
  resolveNode: (uses: string) => AnyNodeOrTrigger | null
  lifecycle?: LifecycleEmitter
}

export async function runWorkflow(opts: RunWorkflowOptions): Promise<WorkflowRunResult> {
  const { workflow, plan, triggerNodeId, triggerOutputs, services, resolveNode, lifecycle } = opts

  const startedAt = performance.now()
  const outputs = new Map<string, Record<string, unknown>>()
  outputs.set(triggerNodeId, triggerOutputs)

  const reachable = plan.reachableFrom.get(triggerNodeId) ?? new Set([triggerNodeId])
  let responseResult: WorkflowRunResult | null = null

  for (const wave of plan.waves) {
    const tasks: Promise<void>[] = []
    for (const nodeId of wave) {
      if (!reachable.has(nodeId)) continue
      if (nodeId === triggerNodeId) {
        lifecycle?.emit({ type: "before-node", nodeId, input: {} })
        lifecycle?.emit({ type: "after-node", nodeId, output: triggerOutputs, durationMs: 0 })
        continue
      }
      tasks.push(runOneNode(nodeId, opts, outputs, lifecycle).then((res) => {
        if (res?.kind === "response") responseResult = res.value
      }))
    }
    if (tasks.length > 0) await Promise.all(tasks)
    if (responseResult) break
  }

  lifecycle?.emit({ type: "complete", totalMs: performance.now() - startedAt })

  if (responseResult) return responseResult
  return { status: 200, body: null, headers: {} }
}

interface RunNodeResult {
  kind: "response"
  value: WorkflowRunResult
}

async function runOneNode(
  nodeId: string,
  opts: RunWorkflowOptions,
  outputs: Map<string, Record<string, unknown>>,
  lifecycle: LifecycleEmitter | undefined,
): Promise<RunNodeResult | null> {
  const instance = opts.workflow.nodes[nodeId]
  if (!instance) return null
  const nodeDef = opts.resolveNode(instance.uses)
  if (!nodeDef) {
    throw new NodeRunError(nodeId, new Error(`unresolved \`uses\`: ${instance.uses}`))
  }

  // Resolve inputs from references and literals.
  const input: Record<string, unknown> = {}
  for (const [field, raw] of Object.entries(instance.in ?? {})) {
    const resolved = resolveInputValue(raw)
    if (resolved.kind === "literal") {
      input[field] = resolved.value
    } else {
      const upstream = outputs.get(resolved.ref.nodeId)
      if (!upstream) {
        throw new NodeRunError(nodeId, new Error(`upstream \`${resolved.ref.nodeId}\` produced no output`))
      }
      let v: unknown = upstream
      for (const seg of resolved.ref.path) {
        v = (v as Record<string, unknown>)?.[seg]
      }
      input[field] = v
      lifecycle?.emit({
        type: "edge-fired",
        from: `${resolved.ref.nodeId}.${resolved.ref.path.join(".")}`,
        to: `${nodeId}.${field}`,
        value: v,
      })
    }
  }

  // Special-case @core/response: collect status/body/headers and short-circuit.
  if (instance.uses === "@core/response") {
    lifecycle?.emit({ type: "before-node", nodeId, input })
    const response: WorkflowRunResult = {
      status: (input.status as number | undefined) ?? 200,
      body: input.body,
      headers: (input.headers as Record<string, string> | undefined) ?? {},
    }
    lifecycle?.emit({
      type: "after-node",
      nodeId,
      output: { sent: true },
      durationMs: 0,
    })
    return { kind: "response", value: response }
  }

  if (nodeDef.kind !== "node") {
    // Non-response trigger nodes are already handled in runWorkflow.
    return null
  }

  lifecycle?.emit({ type: "before-node", nodeId, input })
  const t0 = performance.now()
  let output: Record<string, unknown>
  try {
    output = (await (nodeDef as Node).run(
      input as never,
      opts.services,
      (instance.config ?? undefined) as never,
    )) as Record<string, unknown>
  } catch (err) {
    lifecycle?.emit({ type: "error", nodeId, error: err as Error })
    throw new NodeRunError(nodeId, err)
  }
  lifecycle?.emit({
    type: "after-node",
    nodeId,
    output,
    durationMs: performance.now() - t0,
  })
  outputs.set(nodeId, output)
  return null
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @cozy/runtime test src/exec/run.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/exec/errors.ts \
        packages/runtime/src/exec/run.ts \
        packages/runtime/src/exec/run.test.ts
git commit -m "feat(runtime): workflow interpreter with parallelism, joins, lifecycle events, fail-fast"
```

---

## Task 14: Testing helpers — testWorkflow and traceWorkflow

**Files:**
- Create: `packages/runtime/src/testing/test-workflow.ts`
- Create: `packages/runtime/src/testing/trace-workflow.ts`
- Modify: `packages/runtime/src/testing/index.ts` (replace stub)
- Create: `packages/runtime/src/testing/test-workflow.test.ts`

- [ ] **Step 1: Write failing test for testWorkflow**

Write `packages/runtime/src/testing/test-workflow.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { testWorkflow, traceWorkflow } from "./index.js"
import { parseWorkflow } from "../workflow/parse.js"

describe("testWorkflow", () => {
  it("runs a workflow with provided trigger input and returns the response", async () => {
    const add = defineNode({
      inputs: z.object({ a: z.number(), b: z.number() }),
      outputs: z.object({ sum: z.number() }),
      async run({ a, b }) {
        return { sum: a + b }
      },
    })
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/add", method: "POST" } },
        add: { uses: "./add", in: { a: "req.body.a", b: "req.body.b" } },
        res: { uses: "@core/response", in: { body: "add.sum", status: 200 } },
      },
    })
    const res = await testWorkflow(wf, {
      request: { body: { a: 5, b: 7 }, params: {}, query: {}, headers: {} },
      nodes: { "./add": add },
      services: {},
    })
    expect(res.status).toBe(200)
    expect(res.body).toBe(12)
  })

  it("applies partial service overrides on top of config defaults", async () => {
    const node = defineNode({
      inputs: z.object({}),
      outputs: z.object({ msg: z.string() }),
      async run(_, services) {
        return { msg: (services as { greeting: string }).greeting }
      },
    })
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/", method: "GET" } },
        n: { uses: "./n", in: {} },
        r: { uses: "@core/response", in: { body: "n.msg" } },
      },
    })
    const res = await testWorkflow(wf, {
      request: { body: null, params: {}, query: {}, headers: {} },
      nodes: { "./n": node },
      services: { greeting: "hi" },
    })
    expect(res.body).toBe("hi")
  })
})

describe("traceWorkflow", () => {
  it("captures the input/output of every node", async () => {
    const upper = defineNode({
      inputs: z.object({ s: z.string() }),
      outputs: z.object({ out: z.string() }),
      async run({ s }) {
        return { out: s.toUpperCase() }
      },
    })
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/", method: "GET" } },
        u: { uses: "./u", in: { s: "req.body" } },
        r: { uses: "@core/response", in: { body: "u.out" } },
      },
    })
    const trace = await traceWorkflow(wf, {
      request: { body: "hello", params: {}, query: {}, headers: {} },
      nodes: { "./u": upper },
      services: {},
    })
    expect(trace.at("u").output).toEqual({ out: "HELLO" })
    expect(trace.response.body).toBe("HELLO")
    expect(trace.errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @cozy/runtime test src/testing/`
Expected: import error.

- [ ] **Step 3: Write test-workflow.ts**

Write `packages/runtime/src/testing/test-workflow.ts`:

```ts
import { resolveCoreNode } from "../core/registry.js"
import type { AnyNodeOrTrigger, Services } from "../types.js"
import type { WorkflowFile } from "../workflow/types.js"
import { validateWorkflow } from "../workflow/validate.js"
import { computeExecutionPlan } from "../exec/topology.js"
import { runWorkflow, type WorkflowRunResult } from "../exec/run.js"

export interface RequestInput {
  body: unknown
  params?: Record<string, string>
  query?: Record<string, string>
  headers?: Record<string, string>
}

export interface TestWorkflowOptions {
  request: RequestInput
  nodes?: Record<string, AnyNodeOrTrigger>
  services?: Services
  /** Specify which trigger node to fire when the workflow has multiple. Defaults to the first @core/http-request found. */
  trigger?: string
}

export async function testWorkflow(
  wf: WorkflowFile,
  opts: TestWorkflowOptions,
): Promise<WorkflowRunResult> {
  const { errors, depsByNode } = validateWorkflow(wf)
  if (errors.length > 0) {
    throw new Error(`Invalid workflow:\n${errors.map((e) => `  - ${e.nodeId}.${e.field}: ${e.message}`).join("\n")}`)
  }
  const plan = computeExecutionPlan(wf, depsByNode)
  const triggerNodeId = opts.trigger ?? findFirstHttpTrigger(wf)
  if (!triggerNodeId) {
    throw new Error("testWorkflow: no @core/http-request trigger found in workflow")
  }

  return runWorkflow({
    workflow: wf,
    plan,
    triggerNodeId,
    triggerOutputs: {
      body: opts.request.body,
      params: opts.request.params ?? {},
      query: opts.request.query ?? {},
      headers: opts.request.headers ?? {},
      context: { requestId: "test-" + Math.random().toString(36).slice(2), timestamp: Date.now() },
    },
    services: opts.services ?? {},
    resolveNode: (uses) => resolveCoreNode(uses) ?? opts.nodes?.[uses] ?? null,
  })
}

function findFirstHttpTrigger(wf: WorkflowFile): string | null {
  for (const [id, inst] of Object.entries(wf.nodes)) {
    if (inst.uses === "@core/http-request") return id
  }
  return null
}
```

- [ ] **Step 4: Write trace-workflow.ts**

Write `packages/runtime/src/testing/trace-workflow.ts`:

```ts
import { LifecycleEmitter } from "../exec/lifecycle.js"
import { resolveCoreNode } from "../core/registry.js"
import { runWorkflow, type WorkflowRunResult } from "../exec/run.js"
import { computeExecutionPlan } from "../exec/topology.js"
import { validateWorkflow } from "../workflow/validate.js"
import type { WorkflowFile } from "../workflow/types.js"
import type { TestWorkflowOptions } from "./test-workflow.js"

export interface NodeTrace {
  nodeId: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  durationMs: number
}

export interface TraceResult {
  response: WorkflowRunResult
  errors: Array<{ nodeId: string; error: Error }>
  at(nodeId: string): NodeTrace
  all(): NodeTrace[]
}

export async function traceWorkflow(
  wf: WorkflowFile,
  opts: TestWorkflowOptions,
): Promise<TraceResult> {
  const { errors, depsByNode } = validateWorkflow(wf)
  if (errors.length > 0) {
    throw new Error(`Invalid workflow:\n${errors.map((e) => `  - ${e.nodeId}.${e.field}: ${e.message}`).join("\n")}`)
  }
  const plan = computeExecutionPlan(wf, depsByNode)
  const triggerNodeId = opts.trigger ?? findFirstHttpTrigger(wf)
  if (!triggerNodeId) {
    throw new Error("traceWorkflow: no @core/http-request trigger found in workflow")
  }

  const emitter = new LifecycleEmitter()
  const traces = new Map<string, Partial<NodeTrace>>()
  const traceErrors: Array<{ nodeId: string; error: Error }> = []

  emitter.on("before-node", (e) => {
    traces.set(e.nodeId, { nodeId: e.nodeId, input: e.input })
  })
  emitter.on("after-node", (e) => {
    const t = traces.get(e.nodeId) ?? { nodeId: e.nodeId, input: {} }
    traces.set(e.nodeId, { ...t, output: e.output, durationMs: e.durationMs })
  })
  emitter.on("error", (e) => {
    traceErrors.push({ nodeId: e.nodeId, error: e.error })
  })

  const response = await runWorkflow({
    workflow: wf,
    plan,
    triggerNodeId,
    triggerOutputs: {
      body: opts.request.body,
      params: opts.request.params ?? {},
      query: opts.request.query ?? {},
      headers: opts.request.headers ?? {},
      context: { requestId: "trace-" + Math.random().toString(36).slice(2), timestamp: Date.now() },
    },
    services: opts.services ?? {},
    resolveNode: (uses) => resolveCoreNode(uses) ?? opts.nodes?.[uses] ?? null,
    lifecycle: emitter,
  })

  return {
    response,
    errors: traceErrors,
    at(nodeId: string): NodeTrace {
      const t = traces.get(nodeId)
      if (!t || !t.output) throw new Error(`No trace for node \`${nodeId}\``)
      return t as NodeTrace
    },
    all(): NodeTrace[] {
      return [...traces.values()].filter((t): t is NodeTrace => Boolean(t.output))
    },
  }
}

function findFirstHttpTrigger(wf: WorkflowFile): string | null {
  for (const [id, inst] of Object.entries(wf.nodes)) {
    if (inst.uses === "@core/http-request") return id
  }
  return null
}
```

- [ ] **Step 5: Update testing/index.ts**

Replace `packages/runtime/src/testing/index.ts`:

```ts
export { testWorkflow } from "./test-workflow.js"
export type { TestWorkflowOptions, RequestInput } from "./test-workflow.js"
export { traceWorkflow } from "./trace-workflow.js"
export type { TraceResult, NodeTrace } from "./trace-workflow.js"
```

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm --filter @cozy/runtime test src/testing/`
Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/testing/
git commit -m "feat(runtime): testWorkflow and traceWorkflow helpers"
```

---

## Task 15: Dev server — workspace loader

**Files:**
- Create: `packages/runtime/src/dev-server/load.ts`
- Create: `packages/runtime/src/dev-server/load.test.ts`

- [ ] **Step 1: Write failing loader test**

Write `packages/runtime/src/dev-server/load.test.ts`:

```ts
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadWorkspace } from "./load.js"

describe("loadWorkspace", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cozy-load-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("finds .workflow files in workflows/", async () => {
    mkdirSync(join(dir, "workflows", "users"), { recursive: true })
    writeFileSync(
      join(dir, "workflows", "users", "create.workflow"),
      JSON.stringify({
        cozy: 1,
        nodes: {
          req: { uses: "@core/http-request", config: { path: "/users", method: "POST" } },
          res: { uses: "@core/response", in: { body: "req.body" } },
        },
      }),
    )
    const ws = await loadWorkspace(dir)
    expect(ws.workflows).toHaveLength(1)
    expect(ws.workflows[0]?.relativePath).toBe("users/create.workflow")
    expect(ws.workflows[0]?.file.nodes.req.uses).toBe("@core/http-request")
  })

  it("returns empty arrays when directories are missing", async () => {
    const ws = await loadWorkspace(dir)
    expect(ws.workflows).toEqual([])
    expect(ws.nodes).toEqual({})
  })

  it("collects errors instead of throwing on a malformed .workflow file", async () => {
    mkdirSync(join(dir, "workflows"), { recursive: true })
    writeFileSync(join(dir, "workflows", "bad.workflow"), "{not valid json")
    const ws = await loadWorkspace(dir)
    expect(ws.workflows).toEqual([])
    expect(ws.errors).toHaveLength(1)
    expect(ws.errors[0]?.message).toMatch(/JSON|Invalid/i)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @cozy/runtime test src/dev-server/load.test.ts`
Expected: import error.

- [ ] **Step 3: Write load.ts**

Write `packages/runtime/src/dev-server/load.ts`:

```ts
import { readdir, readFile, stat } from "node:fs/promises"
import { extname, join, relative } from "node:path"
import type { AnyNodeOrTrigger } from "../types.js"
import { parseWorkflowFromString } from "../workflow/parse.js"
import type { WorkflowFile } from "../workflow/types.js"

export interface LoadedWorkflow {
  relativePath: string
  absolutePath: string
  file: WorkflowFile
}

export interface LoadedWorkspace {
  root: string
  workflows: LoadedWorkflow[]
  /** Map from a `uses` reference (e.g. "./nodes/foo") to its loaded Node/Trigger. */
  nodes: Record<string, AnyNodeOrTrigger>
  errors: Array<{ path: string; message: string }>
}

export async function loadWorkspace(root: string): Promise<LoadedWorkspace> {
  const workflows: LoadedWorkflow[] = []
  const errors: LoadedWorkspace["errors"] = []

  const workflowsDir = join(root, "workflows")
  if (await exists(workflowsDir)) {
    for await (const abs of walk(workflowsDir, ".workflow")) {
      try {
        const text = await readFile(abs, "utf-8")
        const file = parseWorkflowFromString(text)
        workflows.push({
          absolutePath: abs,
          relativePath: relative(workflowsDir, abs).replaceAll("\\", "/"),
          file,
        })
      } catch (e) {
        errors.push({ path: abs, message: (e as Error).message })
      }
    }
  }

  // Node modules are loaded lazily by the dev server (it imports them on demand).
  // We don't pre-load them here because Node ESM dynamic imports must happen at use site.
  const nodes: Record<string, AnyNodeOrTrigger> = {}

  return { root, workflows, nodes, errors }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function* walk(dir: string, extension: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full, extension)
    } else if (extname(entry.name) === extension) {
      yield full
    }
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @cozy/runtime test src/dev-server/load.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/dev-server/load.ts packages/runtime/src/dev-server/load.test.ts
git commit -m "feat(runtime): workspace loader — discover and parse .workflow files in a directory"
```

---

## Task 16: Dev server — Hono mount

**Files:**
- Create: `packages/runtime/src/dev-server/server.ts`
- Create: `packages/runtime/src/dev-server/server.test.ts`

- [ ] **Step 1: Write failing server test**

Write `packages/runtime/src/dev-server/server.test.ts`:

```ts
import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { parseWorkflow } from "../workflow/parse.js"
import { mountWorkflows } from "./server.js"
import type { LoadedWorkflow } from "./load.js"

describe("mountWorkflows", () => {
  it("registers HTTP routes from workflows and responds to fetch", async () => {
    const add = defineNode({
      inputs: z.object({ a: z.number(), b: z.number() }),
      outputs: z.object({ sum: z.number() }),
      async run({ a, b }) {
        return { sum: a + b }
      },
    })

    const wf: LoadedWorkflow = {
      absolutePath: "/fake/workflows/add.workflow",
      relativePath: "add.workflow",
      file: parseWorkflow({
        cozy: 1,
        nodes: {
          req: { uses: "@core/http-request", config: { path: "/add", method: "POST" } },
          add: { uses: "./add", in: { a: "req.body.a", b: "req.body.b" } },
          res: { uses: "@core/response", in: { body: "add.sum", status: 200 } },
        },
      }),
    }

    const app = new Hono()
    mountWorkflows(app, [wf], {
      nodes: { "./add": add },
      services: {},
    })

    const res = await app.request("/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 3, b: 4 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toBe(7)
  })

  it("registers multiple triggers in a single workflow as independent routes", async () => {
    const wf: LoadedWorkflow = {
      absolutePath: "/fake/users.workflow",
      relativePath: "users.workflow",
      file: parseWorkflow({
        cozy: 1,
        nodes: {
          getReq: { uses: "@core/http-request", config: { path: "/users", method: "GET" } },
          postReq: { uses: "@core/http-request", config: { path: "/users", method: "POST" } },
          getRes: { uses: "@core/response", in: { body: { $literal: "list" } } },
          postRes: { uses: "@core/response", in: { body: "postReq.body" } },
        },
      }),
    }
    const app = new Hono()
    mountWorkflows(app, [wf], { nodes: {}, services: {} })

    const getRes = await app.request("/users", { method: "GET" })
    expect(await getRes.json()).toBe("list")

    const postRes = await app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ada" }),
    })
    expect(await postRes.json()).toEqual({ name: "ada" })
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @cozy/runtime test src/dev-server/server.test.ts`
Expected: import error.

- [ ] **Step 3: Write server.ts**

Write `packages/runtime/src/dev-server/server.ts`:

```ts
import type { Hono } from "hono"
import { resolveCoreNode } from "../core/registry.js"
import { runWorkflow } from "../exec/run.js"
import { computeExecutionPlan } from "../exec/topology.js"
import { validateWorkflow } from "../workflow/validate.js"
import type { AnyNodeOrTrigger, Services } from "../types.js"
import type { LoadedWorkflow } from "./load.js"
import type { LifecycleEmitter } from "../exec/lifecycle.js"

export interface MountOptions {
  nodes: Record<string, AnyNodeOrTrigger>
  services: Services
  lifecycle?: LifecycleEmitter
}

export function mountWorkflows(app: Hono, workflows: LoadedWorkflow[], opts: MountOptions): void {
  for (const wf of workflows) {
    const { errors, depsByNode } = validateWorkflow(wf.file)
    if (errors.length > 0) {
      console.error(`Skipping ${wf.relativePath}: ${errors.length} validation error(s)`)
      for (const e of errors) console.error(`  - ${e.nodeId}.${e.field}: ${e.message}`)
      continue
    }
    const plan = computeExecutionPlan(wf.file, depsByNode)

    for (const [nodeId, inst] of Object.entries(wf.file.nodes)) {
      if (inst.uses !== "@core/http-request") continue
      const config = inst.config as { path?: string; method?: string }
      const path = config?.path ?? "/"
      const method = (config?.method ?? "GET").toLowerCase()

      const handler = async (c: { req: Request; json: (b: unknown, s?: number) => Response; text: (b: string, s?: number) => Response }) => {
        const reqId = crypto.randomUUID()
        let body: unknown = null
        const contentType = c.req.headers.get("content-type") ?? ""
        if (contentType.includes("application/json")) {
          try {
            body = await c.req.json()
          } catch {
            body = null
          }
        } else if (c.req.body) {
          body = await c.req.text()
        }

        const url = new URL(c.req.url)
        const query: Record<string, string> = {}
        url.searchParams.forEach((v, k) => { query[k] = v })
        const headers: Record<string, string> = {}
        c.req.headers.forEach((v, k) => { headers[k] = v })

        const result = await runWorkflow({
          workflow: wf.file,
          plan,
          triggerNodeId: nodeId,
          triggerOutputs: {
            body,
            params: extractParams(path, url.pathname),
            query,
            headers,
            context: { requestId: reqId, timestamp: Date.now() },
          },
          services: opts.services,
          resolveNode: (uses) => resolveCoreNode(uses) ?? opts.nodes[uses] ?? null,
          lifecycle: opts.lifecycle,
        })

        return new Response(typeof result.body === "string" ? result.body : JSON.stringify(result.body), {
          status: result.status,
          headers: {
            "content-type":
              typeof result.body === "string" ? "text/plain" : "application/json",
            ...result.headers,
          },
        }) as unknown as Response
      }

      // app.on() exists for arbitrary methods; .get/.post/etc. are convenience wrappers.
      ;(app as unknown as { on(m: string, p: string, h: typeof handler): void }).on(method.toUpperCase(), path, handler)
    }
  }
}

/** Extracts :param values from a Hono-style path against an actual pathname. */
function extractParams(template: string, actual: string): Record<string, string> {
  const tParts = template.split("/").filter(Boolean)
  const aParts = actual.split("/").filter(Boolean)
  if (tParts.length !== aParts.length) return {}
  const params: Record<string, string> = {}
  for (let i = 0; i < tParts.length; i++) {
    const t = tParts[i]!
    const a = aParts[i]!
    if (t.startsWith(":")) params[t.slice(1)] = decodeURIComponent(a)
  }
  return params
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @cozy/runtime test src/dev-server/server.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/dev-server/server.ts packages/runtime/src/dev-server/server.test.ts
git commit -m "feat(runtime): mountWorkflows — register .workflow files on a Hono app"
```

---

## Task 17: Public API + index re-exports

**Files:**
- Modify: `packages/runtime/src/index.ts`

- [ ] **Step 1: Update index.ts with the full public API**

Replace `packages/runtime/src/index.ts`:

```ts
// Helpers
export { defineConfig } from "./define-config.js"
export { defineNode } from "./define-node.js"
export { defineTrigger } from "./define-trigger.js"
export type { DefineNodeInput } from "./define-node.js"
export type { DefineTriggerInput } from "./define-trigger.js"

// Core types
export type {
  Disposable,
  Node,
  ServiceContext,
  ServiceValue,
  Services,
  Trigger,
  WorkflowConfig,
} from "./types.js"

// Workflow file primitives
export {
  parseWorkflow,
  parseWorkflowFromString,
  WorkflowParseError,
} from "./workflow/parse.js"
export { validateWorkflow } from "./workflow/validate.js"
export type { ValidationError, ValidationResult } from "./workflow/validate.js"
export type {
  NodeInstance,
  NodeView,
  ParsedReference,
  ResolvedInputValue,
  WorkflowFile,
} from "./workflow/types.js"

// Execution
export { runWorkflow } from "./exec/run.js"
export type { RunWorkflowOptions, WorkflowRunResult } from "./exec/run.js"
export { computeExecutionPlan } from "./exec/topology.js"
export type { ExecutionPlan } from "./exec/topology.js"
export { LifecycleEmitter } from "./exec/lifecycle.js"
export type { LifecycleEvent, LifecycleEventType } from "./exec/lifecycle.js"
export { NodeRunError, WorkflowError } from "./exec/errors.js"

// Built-ins
export {
  CORE_NODE_IDS,
  isCoreReference,
  resolveCoreNode,
} from "./core/registry.js"

// Dev server
export { loadWorkspace } from "./dev-server/load.js"
export type { LoadedWorkflow, LoadedWorkspace } from "./dev-server/load.js"
export { mountWorkflows } from "./dev-server/server.js"
export type { MountOptions } from "./dev-server/server.js"

export const VERSION = "0.0.0"
```

- [ ] **Step 2: Run full test + build + typecheck**

Run: `pnpm --filter @cozy/runtime test`
Expected: all tests across all files pass.

Run: `pnpm --filter @cozy/runtime typecheck`
Expected: clean.

Run: `pnpm --filter @cozy/runtime build`
Expected: `dist/index.js` and `dist/testing/index.js` produced with their `.d.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/runtime/src/index.ts
git commit -m "feat(runtime): finalize public API surface"
```

---

## Task 18: Acceptance test — full example workspace

**Files:**
- Create: `examples/basic-api/package.json`
- Create: `examples/basic-api/tsconfig.json`
- Create: `examples/basic-api/cozy.config.ts`
- Create: `examples/basic-api/nodes/parse-credentials.ts`
- Create: `examples/basic-api/nodes/save-user.ts`
- Create: `examples/basic-api/workflows/users/create.workflow`
- Create: `examples/basic-api/workflows/users/create.test.ts`
- Create: `examples/basic-api/src/server.ts`
- Create: `examples/basic-api/src/server.test.ts`

- [ ] **Step 1: Create example package.json**

Write `examples/basic-api/package.json`:

```json
{
  "name": "@cozy-example/basic-api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@cozy/runtime": "workspace:*",
    "hono": "^4.12.21",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^25.9.1",
    "tsx": "^4.20.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.7"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Write `examples/basic-api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": ".",
    "allowImportingTsExtensions": false
  },
  "include": ["src/**/*", "nodes/**/*", "cozy.config.ts", "workflows/**/*.test.ts"]
}
```

- [ ] **Step 3: Create cozy.config.ts**

Write `examples/basic-api/cozy.config.ts`:

```ts
import { defineConfig } from "@cozy/runtime"

interface User {
  id: string
  email: string
}

interface Db {
  createUser(email: string, passwordHash: string): Promise<User>
}

const inMemoryDb: Db = {
  async createUser(email) {
    return { id: crypto.randomUUID(), email }
  },
}

interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void
}

const baseLogger: Logger = {
  info: (msg, fields) => console.log("[info]", msg, fields ?? ""),
}

export default defineConfig({
  target: "hono",
  services: {
    db: inMemoryDb,
    logger: () => baseLogger,
  },
})
```

- [ ] **Step 4: Create parse-credentials node**

Write `examples/basic-api/nodes/parse-credentials.ts`:

```ts
import { defineNode } from "@cozy/runtime"
import { z } from "zod"

export default defineNode({
  name: "Parse Credentials",
  inputs: z.object({ raw: z.unknown() }),
  outputs: z.object({ email: z.string(), password: z.string() }),
  async run({ raw }) {
    const parsed = z
      .object({ email: z.string().email(), password: z.string().min(6) })
      .parse(raw)
    return parsed
  },
})
```

- [ ] **Step 5: Create save-user node**

Write `examples/basic-api/nodes/save-user.ts`:

```ts
import { defineNode } from "@cozy/runtime"
import { z } from "zod"

export default defineNode({
  name: "Save User",
  inputs: z.object({ email: z.string(), passwordHash: z.string() }),
  outputs: z.object({
    user: z.object({ id: z.string(), email: z.string() }),
  }),
  async run({ email, passwordHash }, services) {
    void passwordHash // (not stored; demo)
    const db = (services as { db: { createUser(e: string, p: string): Promise<{ id: string; email: string }> } }).db
    const user = await db.createUser(email, passwordHash)
    return { user }
  },
})
```

- [ ] **Step 6: Create the workflow file**

Write `examples/basic-api/workflows/users/create.workflow`:

```json
{
  "cozy": 1,
  "nodes": {
    "request": {
      "uses": "@core/http-request",
      "config": { "path": "/users", "method": "POST" }
    },
    "creds": {
      "uses": "./nodes/parse-credentials",
      "in": { "raw": "request.body" }
    },
    "save": {
      "uses": "./nodes/save-user",
      "in": {
        "email": "creds.email",
        "passwordHash": "creds.password"
      }
    },
    "response": {
      "uses": "@core/response",
      "in": { "body": "save.user", "status": 201 }
    }
  }
}
```

- [ ] **Step 7: Create the workflow test**

Write `examples/basic-api/workflows/users/create.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseWorkflowFromString } from "@cozy/runtime"
import { testWorkflow, traceWorkflow } from "@cozy/runtime/testing"
import { describe, expect, it } from "vitest"
import parseCredentials from "../../nodes/parse-credentials.js"
import saveUser from "../../nodes/save-user.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const workflow = parseWorkflowFromString(readFileSync(join(__dirname, "create.workflow"), "utf-8"))

const nodes = {
  "./nodes/parse-credentials": parseCredentials,
  "./nodes/save-user": saveUser,
}

const services = {
  db: {
    async createUser(email: string) {
      return { id: "test-id", email }
    },
  },
  logger: { info: () => {} },
}

describe("POST /users workflow", () => {
  it("creates a user from valid credentials", async () => {
    const res = await testWorkflow(workflow, {
      request: { body: { email: "ada@example.com", password: "hunter2" } },
      nodes,
      services,
    })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: "test-id", email: "ada@example.com" })
  })

  it("rejects malformed credentials by throwing", async () => {
    await expect(
      testWorkflow(workflow, {
        request: { body: { email: "not-an-email", password: "x" } },
        nodes,
        services,
      }),
    ).rejects.toThrow()
  })

  it("traceWorkflow exposes intermediate node outputs", async () => {
    const trace = await traceWorkflow(workflow, {
      request: { body: { email: "ada@example.com", password: "hunter2" } },
      nodes,
      services,
    })
    expect(trace.at("creds").output).toEqual({ email: "ada@example.com", password: "hunter2" })
    expect(trace.at("save").output).toEqual({ user: { id: "test-id", email: "ada@example.com" } })
  })
})
```

- [ ] **Step 8: Create the server entry**

Write `examples/basic-api/src/server.ts`:

```ts
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { loadWorkspace, mountWorkflows } from "@cozy/runtime"
import parseCredentials from "../nodes/parse-credentials.js"
import saveUser from "../nodes/save-user.js"
import config from "../cozy.config.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

export async function buildApp(): Promise<Hono> {
  const ws = await loadWorkspace(root)
  if (ws.errors.length > 0) {
    for (const e of ws.errors) console.error(e.path, e.message)
  }
  const app = new Hono()
  const services: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(config.services)) {
    services[name] = typeof value === "function" ? value({ requestId: "boot", timestamp: 0 }) : value
  }
  mountWorkflows(app, ws.workflows, {
    nodes: {
      "./nodes/parse-credentials": parseCredentials,
      "./nodes/save-user": saveUser,
    },
    services,
  })
  return app
}
```

- [ ] **Step 9: Create the server integration test**

Write `examples/basic-api/src/server.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildApp } from "./server.js"

describe("dev server end-to-end", () => {
  it("serves POST /users", async () => {
    const app = await buildApp()
    const res = await app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "hunter2" }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.email).toBe("ada@example.com")
    expect(typeof body.id).toBe("string")
  })

  it("returns a server error on invalid input", async () => {
    const app = await buildApp()
    const res = await app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bad", password: "x" }),
    })
    expect(res.status).toBeGreaterThanOrEqual(500)
  })
})
```

- [ ] **Step 10: Install + verify**

Run: `pnpm install`
Expected: example package linked.

Run: `pnpm --filter @cozy-example/basic-api typecheck`
Expected: clean.

Run: `pnpm --filter @cozy-example/basic-api test`
Expected: all tests pass.

- [ ] **Step 11: Run the whole monorepo's tests**

Run: `pnpm test`
Expected: every package's tests pass.

- [ ] **Step 12: Commit**

```bash
git add examples/basic-api/ pnpm-lock.yaml
git commit -m "feat(examples): basic-api end-to-end example exercising workflow + nodes + tests + dev server"
```

---

## Plan complete

After Task 18, sub-project #1 (the headless `@cozy/runtime`) meets these acceptance criteria from §10 of the spec:

- [x] A user can author `cozy.config.ts`, `.workflow` JSON, and `defineNode` TS files by hand.
- [x] An interpreter executes those workflows; HTTP routes go live via Hono.
- [x] Lifecycle events flow over a subscriber API (websocket bridge will come later in the IDE sub-project — for now they're emitted in-process).
- [x] Vitest tests against workflows pass (`testWorkflow` + `traceWorkflow`).
- [x] Programmatic node invocation works (`import myNode; myNode.run(...)`).

The `cozy build` codegen, the `cozy` CLI binary, and OpenAPI import are explicitly out of scope for this plan — they're in plans #2 and #3.

---

## Open follow-ups (for plan #2 — `@cozy/build`)

These are notes for the next plan, not gaps in this one:

- A `cozy` CLI entry point and `commander` setup.
- A codegen module that walks `.workflow` files and emits idiomatic TS for Hono.
- Parallel-grouping output (the same logic as `computeExecutionPlan` but rendered as `Promise.all`).
- The services type generator (`.cozy/types/services.d.ts`).
- The schema extractor that loads each node module in a controlled context and reads its Zod schemas.
- The `cozy init` command that scaffolds `AGENTS.md` and sample structure.
- The equivalence harness (interpreter vs codegen) as a CI gate.
