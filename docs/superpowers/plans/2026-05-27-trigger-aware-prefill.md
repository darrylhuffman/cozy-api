# Trigger-Aware Request Pre-fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Picking a trigger in the Run-tab pre-fills the request body/query/headers from the schemas of nodes that consume the trigger's outputs. Lock the method dropdown (driven entirely by the trigger pick); keep the path editable.

**Architecture:** Two pure helpers (`discoverTriggerConsumers`, `sampleFromSchema`) feed into a `TriggerSelector` that fetches workspace schemas once and re-runs the pre-fill when schemas arrive or the trigger changes. Pre-fill is empty-guarded so user edits stick. `RequestBuilder` swaps the method `<select>` for a read-only badge.

**Tech Stack:** React 19, TypeScript ESM (NodeNext), Zustand, Vitest + `@testing-library/react`, existing IDE conventions.

**Working dir:** `C:\Users\hello\source\cozy-api`. Branch: continue on `main` or branch off as a feature branch (recommend `feat/trigger-prefill`). Spec: `docs/superpowers/specs/2026-05-27-trigger-aware-prefill-design.md`.

**Reading first:** the spec sections §2 (discovery), §3 (sample gen), §4 (TriggerSelector), §5 (RequestBuilder), §6 (empty semantics).

**Tsbuildinfo cache note:** Before each typecheck, `rm -f packages/ide/tsconfig.app.tsbuildinfo packages/ide/tsconfig.node.tsbuildinfo` to avoid stale errors.

---

## File map

**Create:**
- `packages/ide/src/panels/run-tab/sample-from-schema.ts` — pure JsonSchema → sample-value generator
- `packages/ide/src/panels/run-tab/sample-from-schema.test.ts`
- `packages/ide/src/panels/run-tab/discover-trigger-consumers.ts` — pure workflow + schemas → `ConsumedShapes`
- `packages/ide/src/panels/run-tab/discover-trigger-consumers.test.ts`

**Modify:**
- `packages/ide/src/panels/run-tab/trigger-selector.tsx` — local schemas fetch, `pickTrigger` enhanced, late-arrival effect
- `packages/ide/src/panels/run-tab/trigger-selector.test.tsx` — pre-fill cases
- `packages/ide/src/panels/run-tab/request-builder.tsx` — replace method `<select>` with a read-only badge

---

## Task 1: `sampleFromSchema` helper

**Files:**
- Create: `packages/ide/src/panels/run-tab/sample-from-schema.ts`
- Create: `packages/ide/src/panels/run-tab/sample-from-schema.test.ts`

### Step 1: Write failing tests

`packages/ide/src/panels/run-tab/sample-from-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { sampleFromSchema } from "./sample-from-schema"
import type { JsonSchema } from "@/lib/api"

describe("sampleFromSchema", () => {
  it("returns null for null/undefined", () => {
    expect(sampleFromSchema(null)).toBeNull()
  })

  it('returns default if present (over enum, over type)', () => {
    const schema: JsonSchema = { type: "string", default: "preset", enum: ["a", "b"] }
    expect(sampleFromSchema(schema)).toBe("preset")
  })

  it("returns the first enum value when enum is non-empty", () => {
    expect(sampleFromSchema({ type: "string", enum: ["GET", "POST"] })).toBe("GET")
  })

  it("string type → empty string", () => {
    expect(sampleFromSchema({ type: "string" })).toBe("")
  })

  it("number/integer type → 0", () => {
    expect(sampleFromSchema({ type: "number" })).toBe(0)
    expect(sampleFromSchema({ type: "integer" })).toBe(0)
  })

  it("boolean type → false", () => {
    expect(sampleFromSchema({ type: "boolean" })).toBe(false)
  })

  it("array type → empty array (no item synthesis in v1)", () => {
    expect(
      sampleFromSchema({
        type: "array",
        items: { type: "string" },
      }),
    ).toEqual([])
  })

  it("object recurses over properties; missing properties → empty object", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        email: { type: "string" },
        age: { type: "integer" },
        active: { type: "boolean" },
      },
    }
    expect(sampleFromSchema(schema)).toEqual({
      email: "",
      age: 0,
      active: false,
    })
  })

  it("nested objects recurse", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      },
    }
    expect(sampleFromSchema(schema)).toEqual({ user: { name: "" } })
  })

  it("object with no properties → empty object", () => {
    expect(sampleFromSchema({ type: "object" })).toEqual({})
  })

  it("unknown type → null", () => {
    expect(sampleFromSchema({ type: "weird" as never })).toBeNull()
  })

  it("schema with no type and no enum → null", () => {
    expect(sampleFromSchema({})).toBeNull()
  })

  it("enum with one value → that value (preserves type)", () => {
    expect(sampleFromSchema({ enum: [42] })).toBe(42)
  })
})
```

### Step 2: Verify FAIL

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test sample-from-schema -- --run 2>&1 | tail -15
```

Expected: FAIL — module not found.

### Step 3: Implement

`packages/ide/src/panels/run-tab/sample-from-schema.ts`:

```ts
import type { JsonSchema } from "@/lib/api"

/**
 * Generate a sample JS value from a JsonSchema. Used to pre-fill request
 * bodies / query / headers from inferred schemas. Returns `null` for
 * malformed or unrecognized schemas.
 *
 * Precedence: default → enum[0] → type-based default.
 *  - string → ""
 *  - number/integer → 0
 *  - boolean → false
 *  - array → [] (no item synthesis in v1)
 *  - object → recursive fill of properties (empty if no properties)
 *  - unknown / missing type → null
 */
export function sampleFromSchema(schema: JsonSchema | null | undefined): unknown {
  if (!schema) return null
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  switch (schema.type) {
    case "string":
      return ""
    case "number":
    case "integer":
      return 0
    case "boolean":
      return false
    case "array":
      return []
    case "object": {
      const out: Record<string, unknown> = {}
      if (schema.properties) {
        for (const [k, sub] of Object.entries(schema.properties)) {
          out[k] = sampleFromSchema(sub)
        }
      }
      return out
    }
    default:
      return null
  }
}
```

### Step 4: Verify PASS

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test sample-from-schema -- --run 2>&1 | tail -15
```

Expected: 13 tests green.

### Step 5: Commit

```bash
git add packages/ide/src/panels/run-tab/sample-from-schema.ts packages/ide/src/panels/run-tab/sample-from-schema.test.ts
git commit -m "feat(ide): sampleFromSchema helper — JsonSchema → sample value

Pure function used by the Run-tab pre-fill. Precedence: default →
enum[0] → type-based default. Object recurses; array defaults to []
(no item synthesis in v1). Unknown / missing type → null.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: `discoverTriggerConsumers` helper

**Files:**
- Create: `packages/ide/src/panels/run-tab/discover-trigger-consumers.ts`
- Create: `packages/ide/src/panels/run-tab/discover-trigger-consumers.test.ts`

### Step 1: Write failing tests

`packages/ide/src/panels/run-tab/discover-trigger-consumers.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { discoverTriggerConsumers } from "./discover-trigger-consumers"
import type { NodeSchemas, WorkflowFile } from "@/lib/api"

const saveUserSchema: NodeSchemas = {
  inputs: {
    type: "object",
    properties: {
      email: { type: "string" },
      password: { type: "string" },
    },
  },
  outputs: { type: "object", properties: { user: { type: "object" } } },
}

const echoSchema: NodeSchemas = {
  inputs: {
    type: "object",
    properties: {
      msg: { type: "string" },
    },
  },
  outputs: { type: "object", properties: { msg: { type: "string" } } },
}

describe("discoverTriggerConsumers", () => {
  it("per-field references: builds an object schema from consumer field schemas", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        SaveUser: {
          uses: "./nodes/save-user",
          in: {
            email: "Request.body.email",
            password: "Request.body.password",
          },
        },
      },
    }
    const schemas = { "./nodes/save-user": saveUserSchema }
    const result = discoverTriggerConsumers(workflow, "Request", schemas)
    expect(result.body).toEqual({
      type: "object",
      properties: {
        email: { type: "string" },
        password: { type: "string" },
      },
    })
    expect(result.query).toBeNull()
    expect(result.headers).toBeNull()
  })

  it("whole-object reference: uses the consumer's full inputs schema", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        Echo: {
          uses: "./nodes/echo",
          in: "Request.body",
        },
      },
    }
    const schemas = { "./nodes/echo": echoSchema }
    const result = discoverTriggerConsumers(workflow, "Request", schemas)
    expect(result.body).toEqual(echoSchema.inputs)
  })

  it("multiple per-field consumers merge their properties", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        SaveUser: {
          uses: "./nodes/save-user",
          in: { email: "Request.body.email" },
        },
        SaveProfile: {
          uses: "./nodes/save-profile",
          in: { displayName: "Request.body.name" },
        },
      },
    }
    const schemas: Record<string, NodeSchemas> = {
      "./nodes/save-user": saveUserSchema,
      "./nodes/save-profile": {
        inputs: { type: "object", properties: { displayName: { type: "string" } } },
        outputs: { type: "object" },
      },
    }
    const result = discoverTriggerConsumers(workflow, "Request", schemas)
    expect(result.body?.properties).toEqual({
      email: { type: "string" },
      name: { type: "string" },
    })
  })

  it("query and headers populate from their respective categories", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        Search: {
          uses: "./nodes/search",
          in: {
            q: "Request.query.q",
            limit: "Request.query.limit",
            auth: "Request.headers.authorization",
          },
        },
      },
    }
    const searchSchema: NodeSchemas = {
      inputs: {
        type: "object",
        properties: {
          q: { type: "string" },
          limit: { type: "integer" },
          auth: { type: "string" },
        },
      },
      outputs: { type: "object" },
    }
    const result = discoverTriggerConsumers(workflow, "Request", {
      "./nodes/search": searchSchema,
    })
    expect(result.query?.properties).toEqual({
      q: { type: "string" },
      limit: { type: "integer" },
    })
    expect(result.headers?.properties).toEqual({
      authorization: { type: "string" },
    })
    expect(result.body).toBeNull()
  })

  it("references to a different trigger output are ignored", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        OtherTrigger: { uses: "@core/http-request" },
        Reader: {
          uses: "./nodes/reader",
          in: { msg: "OtherTrigger.body.msg" },
        },
      },
    }
    const readerSchema: NodeSchemas = {
      inputs: { type: "object", properties: { msg: { type: "string" } } },
      outputs: { type: "object" },
    }
    const result = discoverTriggerConsumers(workflow, "Request", {
      "./nodes/reader": readerSchema,
    })
    expect(result.body).toBeNull()
    expect(result.query).toBeNull()
    expect(result.headers).toBeNull()
  })

  it("missing consumer schema → consumer is silently skipped", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        Mystery: {
          uses: "./nodes/mystery",
          in: { x: "Request.body.x" },
        },
      },
    }
    const result = discoverTriggerConsumers(workflow, "Request", {})
    expect(result.body).toBeNull()
  })

  it("deeper-than-3 references are skipped (v1 limitation)", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        Reader: {
          uses: "./nodes/reader",
          in: { name: "Request.body.user.name" },
        },
      },
    }
    const readerSchema: NodeSchemas = {
      inputs: { type: "object", properties: { name: { type: "string" } } },
      outputs: { type: "object" },
    }
    const result = discoverTriggerConsumers(workflow, "Request", {
      "./nodes/reader": readerSchema,
    })
    expect(result.body).toBeNull()
  })

  it("workflow where nothing references the trigger → all null", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        Isolated: { uses: "./nodes/isolated" },
      },
    }
    const result = discoverTriggerConsumers(workflow, "Request", {})
    expect(result).toEqual({ body: null, query: null, headers: null })
  })

  it("first-writer-wins on property conflict", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        A: {
          uses: "./nodes/a",
          in: { email: "Request.body.email" },
        },
        B: {
          uses: "./nodes/b",
          in: { email: "Request.body.email" },
        },
      },
    }
    const schemas: Record<string, NodeSchemas> = {
      "./nodes/a": {
        inputs: { type: "object", properties: { email: { type: "string" } } },
        outputs: { type: "object" },
      },
      "./nodes/b": {
        inputs: { type: "object", properties: { email: { type: "integer" } } },
        outputs: { type: "object" },
      },
    }
    const result = discoverTriggerConsumers(workflow, "Request", schemas)
    // First consumer (A) wins; email stays type string
    expect(result.body?.properties?.email).toEqual({ type: "string" })
  })

  it("empty workflow → all null", () => {
    const workflow: WorkflowFile = {
      lorien: 1,
      nodes: {},
    }
    const result = discoverTriggerConsumers(workflow, "Request", {})
    expect(result).toEqual({ body: null, query: null, headers: null })
  })
})
```

### Step 2: Verify FAIL

```bash
pnpm --filter @darrylondil/lorien-ide test discover-trigger-consumers -- --run 2>&1 | tail -15
```

Expected: FAIL — module not found.

### Step 3: Implement

`packages/ide/src/panels/run-tab/discover-trigger-consumers.ts`:

```ts
import type { JsonSchema, NodeSchemas, WorkflowFile } from "@/lib/api"

export interface ConsumedShapes {
  body: JsonSchema | null
  query: JsonSchema | null
  headers: JsonSchema | null
}

type Category = "body" | "query" | "headers"
const CATEGORIES: Category[] = ["body", "query", "headers"]

/**
 * Walks the workflow's nodes and finds `in:` references that read from the
 * trigger's outputs (body / query / headers). For each, resolves the consumer
 * node's input schema and synthesizes an object schema describing what the
 * trigger output must contain.
 *
 * Reference shapes handled:
 *   - per-field:    in: { email: "TriggerId.body.email" }
 *                   contributes { properties.email: SaveUser.inputs.properties.email }
 *   - whole-object: in: "TriggerId.body"
 *                   contributes the consumer's full inputs schema (replaces any prior)
 *
 * Deeper paths ("TriggerId.body.user.email") are skipped — v1 only matches
 * depth-3 per-field refs. Multiple consumers merge properties; on key
 * conflict the first writer wins.
 *
 * The `params` output isn't inferred — params come from URL path matching,
 * not pre-fillable from schema alone.
 */
export function discoverTriggerConsumers(
  workflow: WorkflowFile,
  triggerNodeId: string,
  schemas: Record<string, NodeSchemas>,
): ConsumedShapes {
  const acc: Record<Category, Record<string, JsonSchema>> = {
    body: {},
    query: {},
    headers: {},
  }
  // Track whole-object refs separately — they win over per-field within the same category
  // only when the per-field set is empty. If a per-field already populated, a whole-object
  // ref is ignored (first-writer-wins extended to mixed shapes).
  const wholeObject: Partial<Record<Category, JsonSchema>> = {}

  for (const [nodeId, instance] of Object.entries(workflow.nodes)) {
    if (nodeId === triggerNodeId) continue
    const consumerSchema = schemas[instance.uses]
    if (!consumerSchema) continue

    if (typeof instance.in === "string") {
      const parts = instance.in.split(".")
      if (parts.length === 2 && parts[0] === triggerNodeId) {
        const cat = parts[1] as Category
        if (CATEGORIES.includes(cat)) {
          if (
            Object.keys(acc[cat]).length === 0 &&
            wholeObject[cat] === undefined
          ) {
            wholeObject[cat] = consumerSchema.inputs
          }
        }
      }
      continue
    }

    if (instance.in && typeof instance.in === "object") {
      for (const [field, ref] of Object.entries(instance.in)) {
        if (typeof ref !== "string") continue
        const parts = ref.split(".")
        if (parts.length !== 3) continue
        if (parts[0] !== triggerNodeId) continue
        const cat = parts[1] as Category
        if (!CATEGORIES.includes(cat)) continue
        const path = parts[2]!
        const fieldSchema = consumerSchema.inputs?.properties?.[field]
        if (!fieldSchema) continue
        if (acc[cat][path] === undefined) {
          acc[cat][path] = fieldSchema
        }
      }
    }
  }

  const toShape = (cat: Category): JsonSchema | null => {
    if (Object.keys(acc[cat]).length > 0) {
      return { type: "object", properties: acc[cat] }
    }
    if (wholeObject[cat]) return wholeObject[cat]!
    return null
  }

  return {
    body: toShape("body"),
    query: toShape("query"),
    headers: toShape("headers"),
  }
}
```

### Step 4: Verify PASS

```bash
pnpm --filter @darrylondil/lorien-ide test discover-trigger-consumers -- --run 2>&1 | tail -20
```

Expected: all 10 tests green.

### Step 5: Commit

```bash
git add packages/ide/src/panels/run-tab/discover-trigger-consumers.ts packages/ide/src/panels/run-tab/discover-trigger-consumers.test.ts
git commit -m "feat(ide): discoverTriggerConsumers — workflow + schemas → ConsumedShapes

Pure helper that walks the workflow and finds in: references reading
from the trigger's body/query/headers outputs. Builds a synthesized
JSON object schema per category from the matching consumer-node input
field schemas. Per-field references contribute single properties;
whole-object references provide the full consumer inputs schema (only
when per-field set is empty). Deeper-than-3-segment references are
skipped (v1 limitation). First-writer-wins on property conflicts.

params is intentionally not inferred — path-param values come from
URL matching, not from schema-pre-fill.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: TriggerSelector integration

**Files:**
- Modify: `packages/ide/src/panels/run-tab/trigger-selector.tsx`
- Modify: `packages/ide/src/panels/run-tab/trigger-selector.test.tsx`

Fetches schemas via `fetchWorkspaceSchemas`, enhances `pickTrigger` to consult `discoverTriggerConsumers` + `sampleFromSchema`, adds a late-arrival effect that re-fills when schemas arrive after a trigger is already selected. Pre-fill is empty-guarded so user edits stick.

### Step 1: Write failing tests

Append to `packages/ide/src/panels/run-tab/trigger-selector.test.tsx` (read the existing file first for imports + helpers — match what's already there):

```tsx
import { vi } from "vitest"
import { fetchWorkspaceSchemas, type NodeSchemas } from "@/lib/api"

// Mock fetchWorkspaceSchemas BEFORE rendering. We'll override per-test.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return {
    ...actual,
    fetchWorkspaceSchemas: vi.fn(),
  }
})

const saveUserSchema: NodeSchemas = {
  inputs: {
    type: "object",
    properties: {
      email: { type: "string" },
      password: { type: "string" },
    },
  },
  outputs: { type: "object" },
}

describe("TriggerSelector — trigger-aware pre-fill", () => {
  beforeEach(() => {
    baseStoreReset()
    vi.mocked(fetchWorkspaceSchemas).mockReset()
  })
  afterEach(() => {
    cleanup()
    baseStoreReset()
    setWorkflow(null)
  })

  it("pre-fills body from connected consumer input schema", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "./nodes/save-user": saveUserSchema,
    })
    setWorkflow({
      lorien: 1,
      nodes: {
        Request: {
          uses: "@core/http-request",
          values: { method: "POST", path: "/users" },
        },
        SaveUser: {
          uses: "./nodes/save-user",
          in: {
            email: "Request.body.email",
            password: "Request.body.password",
          },
        },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    // The schema fetch is async — wait for the late-arrival effect to fire
    await waitFor(() => {
      const body = useDebugSessionStore.getState().requestForm.body
      expect(body.trim().length).toBeGreaterThan(0)
    })
    const form = useDebugSessionStore.getState().requestForm
    expect(form.bodyKind).toBe("json")
    const parsed = JSON.parse(form.body) as Record<string, unknown>
    expect(parsed).toEqual({ email: "", password: "" })
  })

  it("pre-fill is skipped when body is already typed", async () => {
    // Pre-set a body in the store BEFORE TriggerSelector mounts
    useDebugSessionStore.getState().setRequestForm((cur) => ({
      ...cur,
      body: '{ "manual": "edit" }',
    }))
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "./nodes/save-user": saveUserSchema,
    })
    setWorkflow({
      lorien: 1,
      nodes: {
        Request: {
          uses: "@core/http-request",
          values: { method: "POST", path: "/users" },
        },
        SaveUser: {
          uses: "./nodes/save-user",
          in: { email: "Request.body.email" },
        },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    // Wait for the late-arrival effect to fire (or NOT fire — but we need
    // some time to elapse so the test can fail meaningfully)
    await new Promise((r) => setTimeout(r, 30))
    const body = useDebugSessionStore.getState().requestForm.body
    expect(body).toBe('{ "manual": "edit" }')
  })

  it("auto-adds Content-Type when body has shape", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "./nodes/save-user": saveUserSchema,
    })
    setWorkflow({
      lorien: 1,
      nodes: {
        Request: {
          uses: "@core/http-request",
          values: { method: "POST", path: "/users" },
        },
        SaveUser: {
          uses: "./nodes/save-user",
          in: { email: "Request.body.email" },
        },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    await waitFor(() => {
      const headers = useDebugSessionStore.getState().requestForm.headers
      expect(headers).toContainEqual(["Content-Type", "application/json"])
    })
  })

  it("pre-fills query rows from query references", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "./nodes/search": {
        inputs: {
          type: "object",
          properties: {
            q: { type: "string" },
            limit: { type: "integer" },
          },
        },
        outputs: { type: "object" },
      } as NodeSchemas,
    })
    setWorkflow({
      lorien: 1,
      nodes: {
        Request: {
          uses: "@core/http-request",
          values: { method: "GET", path: "/search" },
        },
        Search: {
          uses: "./nodes/search",
          in: {
            q: "Request.query.q",
            limit: "Request.query.limit",
          },
        },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    await waitFor(() => {
      const query = useDebugSessionStore.getState().requestForm.query
      expect(query.length).toBe(2)
    })
    const query = useDebugSessionStore.getState().requestForm.query
    expect(query.map(([k]) => k).sort()).toEqual(["limit", "q"])
  })
})
```

NOTE: `baseStoreReset`, `setWorkflow`, `waitFor` are existing helpers in this test file. If they don't exist, create them inline or import from the existing test file structure. Check the existing test imports first.

### Step 2: Verify FAIL

```bash
pnpm --filter @darrylondil/lorien-ide test trigger-selector -- --run 2>&1 | tail -20
```

Expected: the new tests fail — the existing `pickTrigger` doesn't do schema-based pre-fill.

### Step 3: Rewrite `trigger-selector.tsx`

Replace the existing file contents with:

```tsx
import { useEffect, useState } from "react"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useDebugSessionStore } from "@/store/debug-session"
import {
  fetchWorkspaceSchemas,
  type NodeSchemas,
  type WorkflowFile,
} from "@/lib/api"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { discoverTriggerConsumers } from "./discover-trigger-consumers"
import { sampleFromSchema } from "./sample-from-schema"

interface Trigger {
  nodeId: string
  method: string
  path: string
}

function discoverTriggers(workflow: WorkflowFile | null): Trigger[] {
  if (!workflow) return []
  const triggers: Trigger[] = []
  for (const [nodeId, instance] of Object.entries(workflow.nodes)) {
    if (instance.uses !== "@core/http-request") continue
    const values = (instance.values ?? {}) as Record<string, unknown>
    triggers.push({
      nodeId,
      method: (values.method as string | undefined) ?? "GET",
      path: (values.path as string | undefined) ?? "/",
    })
  }
  return triggers
}

function defaultBodyKindForMethod(method: string): "json" | "none" {
  const upper = method.toUpperCase()
  return upper === "POST" || upper === "PUT" || upper === "PATCH"
    ? "json"
    : "none"
}

function pickTrigger(
  t: Trigger,
  workflow: WorkflowFile | null,
  schemas: Record<string, NodeSchemas>,
) {
  const consumed = workflow
    ? discoverTriggerConsumers(workflow, t.nodeId, schemas)
    : { body: null, query: null, headers: null }

  // Body
  const hasBodyShape = consumed.body !== null
  const bodyKind: "none" | "json" =
    hasBodyShape ? "json" : defaultBodyKindForMethod(t.method)
  const sampleBody = hasBodyShape ? sampleFromSchema(consumed.body) : null
  const bodyText =
    sampleBody !== null ? JSON.stringify(sampleBody, null, 2) : ""

  // Query rows
  const queryRows: Array<[string, string]> =
    consumed.query?.type === "object" && consumed.query.properties
      ? Object.keys(consumed.query.properties).map((k) => [k, ""])
      : []

  // Header rows + auto-set Content-Type when body has shape
  const headerRows: Array<[string, string]> = []
  if (consumed.headers?.type === "object" && consumed.headers.properties) {
    for (const k of Object.keys(consumed.headers.properties)) {
      headerRows.push([k, ""])
    }
  }
  if (
    bodyKind === "json" &&
    !headerRows.some(([k]) => k.toLowerCase() === "content-type")
  ) {
    headerRows.push(["Content-Type", "application/json"])
  }

  useDebugSessionStore.getState().setRequestForm((cur) => {
    const bodyEmpty = cur.body.trim().length === 0
    const queryEmpty = cur.query.length === 0
    const headersEmpty = cur.headers.length === 0
    return {
      triggerNodeId: t.nodeId,
      method: t.method,
      path: t.path,
      bodyKind,
      body: bodyEmpty ? bodyText : cur.body,
      formBody: [],
      query: queryEmpty ? queryRows : cur.query,
      headers: headersEmpty ? headerRows : cur.headers,
    }
  })
}

export function TriggerSelector() {
  const workflow = useLiveWorkflowStore((s) => s.workflow)
  const selected = useDebugSessionStore((s) => s.requestForm.triggerNodeId)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)
  const [schemas, setSchemas] = useState<Record<string, NodeSchemas>>({})

  const triggers = discoverTriggers(workflow)

  // Fetch schemas once on mount; cache locally
  useEffect(() => {
    let alive = true
    fetchWorkspaceSchemas()
      .then((s) => {
        if (alive) setSchemas(s)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // Auto-select / form-reset effect
  useEffect(() => {
    if (triggers.length === 0 && selected !== null) {
      setRequestForm(() => ({
        triggerNodeId: null,
        method: "GET",
        path: "/",
        bodyKind: "none",
        body: "",
        formBody: [],
        query: [],
        headers: [],
      }))
      return
    }
    if (
      triggers.length >= 1 &&
      (selected === null || !triggers.find((t) => t.nodeId === selected))
    ) {
      pickTrigger(triggers[0]!, workflow, schemas)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggers.length, triggers.map((t) => t.nodeId).join("|")])

  // Late-arrival effect: when schemas finish loading after a trigger is
  // already selected, re-run pickTrigger so pre-fill can kick in. The
  // empty-check inside pickTrigger guards against clobbering user edits.
  useEffect(() => {
    if (!workflow || !selected || Object.keys(schemas).length === 0) return
    const t = triggers.find((tr) => tr.nodeId === selected)
    if (t) pickTrigger(t, workflow, schemas)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemas])

  if (triggers.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        Add an <code>@core/http-request</code> node to debug this workflow.
      </div>
    )
  }

  const current = triggers.find((t) => t.nodeId === selected) ?? triggers[0]!

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Trigger:</span>
      <Select
        value={current.nodeId}
        onValueChange={(id) => {
          const t = triggers.find((tr) => tr.nodeId === id)
          if (t) pickTrigger(t, workflow, schemas)
        }}
      >
        <SelectTrigger className="h-7 min-w-[180px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {triggers.map((t) => (
            <SelectItem key={t.nodeId} value={t.nodeId}>
              <span className="font-mono">{t.method}</span> {t.path}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
```

### Step 4: Verify PASS

```bash
rm -f packages/ide/tsconfig.app.tsbuildinfo packages/ide/tsconfig.node.tsbuildinfo
pnpm --filter @darrylondil/lorien-ide test trigger-selector -- --run 2>&1 | tail -25
pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected:
- trigger-selector tests green (existing + 4 new)
- typecheck clean

If existing tests fail because they construct workflows without consumer nodes and don't set up the `fetchWorkspaceSchemas` mock, update them: add a `vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({})` at the start of each test that renders `<TriggerSelector />`.

### Step 5: Commit

```bash
git add packages/ide/src/panels/run-tab/trigger-selector.tsx packages/ide/src/panels/run-tab/trigger-selector.test.tsx
git commit -m "feat(ide): TriggerSelector pre-fills body/query/headers from consumer schemas

On mount, fetches workspace schemas once. When a trigger is picked
(auto-select or dropdown change), discoverTriggerConsumers walks the
workflow to find which downstream nodes consume the trigger's
body/query/headers outputs, sampleFromSchema generates sample values,
and the request form is populated only for empty fields (user edits
stick). Content-Type: application/json is auto-set when body has
shape and no Content-Type is present.

A late-arrival effect re-runs the pre-fill when schemas finish
loading after a trigger is already selected.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: RequestBuilder — drop method `<select>`

**Files:**
- Modify: `packages/ide/src/panels/run-tab/request-builder.tsx`
- (Optional) Create: `packages/ide/src/panels/run-tab/request-builder.test.tsx`

### Step 1: Replace the method dropdown with a read-only badge

In `packages/ide/src/panels/run-tab/request-builder.tsx`, the opening row currently is:

```tsx
<div className="flex items-center gap-2">
  <select
    className="rounded-md border bg-background px-2 py-1"
    value={form.method}
    onChange={(e) => setRequestForm((c) => ({ ...c, method: e.target.value }))}
  >
    {METHODS.map((m) => (
      <option key={m} value={m}>
        {m}
      </option>
    ))}
  </select>
  <input
    type="text"
    className="flex-1 rounded-md border bg-background px-2 py-1 font-mono"
    value={form.path}
    onChange={(e) => setRequestForm((c) => ({ ...c, path: e.target.value }))}
  />
</div>
```

Replace with:

```tsx
<div className="flex items-center gap-2">
  <span
    data-testid="request-method"
    className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-muted-foreground"
  >
    {form.method}
  </span>
  <input
    type="text"
    className="flex-1 rounded-md border bg-background px-2 py-1 font-mono"
    value={form.path}
    onChange={(e) => setRequestForm((c) => ({ ...c, path: e.target.value }))}
  />
</div>
```

Also delete the now-unused `METHODS` constant at the top of the file:
```ts
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
```

### Step 2: Add a smoke test (optional but recommended)

Create `packages/ide/src/panels/run-tab/request-builder.test.tsx` (or extend an existing file if one exists):

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { useDebugSessionStore } from "@/store/debug-session"
import { RequestBuilder } from "./request-builder"

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return { ...actual, fetchWorkspaceSchemas: vi.fn().mockResolvedValue({}) }
})

describe("RequestBuilder method UI", () => {
  afterEach(() => {
    cleanup()
    useDebugSessionStore.setState(
      useDebugSessionStore.getState().getInitialState() as never,
    )
  })

  it("does not render a method <select>", () => {
    useDebugSessionStore.getState().setRequestForm(() => ({
      triggerNodeId: "Request",
      method: "POST",
      path: "/users",
      bodyKind: "none",
      body: "",
      formBody: [],
      query: [],
      headers: [],
    }))
    const { container } = render(<RequestBuilder />)
    expect(container.querySelector('select')).toBeNull()
  })

  it("renders the method as a read-only badge", () => {
    useDebugSessionStore.getState().setRequestForm(() => ({
      triggerNodeId: "Request",
      method: "POST",
      path: "/users",
      bodyKind: "none",
      body: "",
      formBody: [],
      query: [],
      headers: [],
    }))
    render(<RequestBuilder />)
    const badge = screen.getByTestId("request-method")
    expect(badge.textContent).toBe("POST")
    // Confirm it's NOT an input
    expect(badge.tagName.toLowerCase()).toBe("span")
  })
})
```

NOTE: if there's an existing `request-builder.test.tsx` in the run-tab folder, just append the describe block.

### Step 3: Verify

```bash
rm -f packages/ide/tsconfig.app.tsbuildinfo packages/ide/tsconfig.node.tsbuildinfo
pnpm --filter @darrylondil/lorien-ide test request-builder -- --run 2>&1 | tail -15
pnpm --filter @darrylondil/lorien-ide test 2>&1 | tail -15
pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected:
- request-builder tests green (2 new)
- Full IDE test suite green
- Typecheck clean

### Step 4: Commit

```bash
git add packages/ide/src/panels/run-tab/request-builder.tsx packages/ide/src/panels/run-tab/request-builder.test.tsx
git commit -m "feat(ide): drop method <select> from RequestBuilder; show as read-only badge

The trigger pick now dictates the method (TriggerSelector calls
setRequestForm with the trigger's method). Showing a separate
dropdown invited drift and confusion. Method is rendered as a
read-only badge alongside the editable path input — path remains
editable so users can substitute :id-style segments.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Final verification

After all 4 tasks land, run the full gate:

```bash
rm -f packages/ide/tsconfig.app.tsbuildinfo packages/ide/tsconfig.node.tsbuildinfo
cd C:/Users/hello/source/cozy-api && pnpm -r test 2>&1 | tail -25
cd C:/Users/hello/source/cozy-api && pnpm -r typecheck 2>&1 | tail -15
cd C:/Users/hello/source/cozy-api && pnpm -r build 2>&1 | tail -15
```

Manual smoke test: open a workflow with a POST `@core/http-request` trigger and a downstream node consuming `Request.body.X` references. Switch to the Run tab. The body should pre-populate with a JSON template matching the consumer's input schema. The method should appear as a non-editable badge. Headers should include `Content-Type: application/json`.
