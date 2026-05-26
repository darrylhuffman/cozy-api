# Trigger-aware request pre-fill + lock method to trigger — design

**Date:** 2026-05-27
**Subsystem:** IDE Run-tab UX (extends the debugger work)
**Status:** brainstorm complete, ready for implementation planning
**Predecessor specs:** `docs/superpowers/specs/2026-05-26-debugger-http-refactor-design.md`, `docs/superpowers/specs/2026-05-25-request-body-picker-design.md`

---

## 1. Goal

When the user picks a trigger in the Run-tab, the IDE inspects the workflow to discover which downstream nodes consume the trigger's `body`/`query`/`headers` outputs, then pre-fills the request form with sample values derived from those nodes' input schemas. The method is no longer user-editable — it's locked to whatever the picked trigger declares. The path stays editable so users can substitute `:id`-style segments.

### In scope

- Pure helper `discoverTriggerConsumers(workflow, triggerNodeId, schemas)` that returns the consumed shapes per category (`body`, `query`, `headers`)
- Pure helper `sampleFromSchema(schema)` that returns a sample JS value from a `JsonSchema`
- `TriggerSelector` integration:
  - Fetches `fetchWorkspaceSchemas` once on mount (local component state; no new store)
  - On trigger pick AND on schemas arriving, runs the discovery + pre-fill
  - Only fills empty fields (body string empty after trim; query empty array; headers empty array) — does not overwrite user edits
  - Auto-sets `Content-Type: application/json` when body schema is non-null and no header is already set
- `RequestBuilder` UI: drop the method `<select>`; display method as a read-only badge alongside the editable path input

### Deferred

- Per-property smart fill ("only this field is empty, fill it in"); v1 treats body/query/headers as all-or-nothing
- Filling array items recursively (`items` schema generation); arrays default to `[]`
- Filling `headers` with sensible defaults beyond schema-derived keys (no Authorization template, etc.)
- Path-params UI ("substitute the `:id` for me"); user still edits the path string directly
- Centralized schemas store (other panels also `fetchWorkspaceSchemas`; consolidation is a follow-up)

---

## 2. Discovery — `discoverTriggerConsumers`

`packages/ide/src/panels/run-tab/discover-trigger-consumers.ts`:

```ts
import type { JsonSchema, NodeSchemas, WorkflowFile } from "@/lib/api"

export interface ConsumedShapes {
  body: JsonSchema | null
  query: JsonSchema | null
  headers: JsonSchema | null
}

/**
 * Walks the workflow's nodes and finds `in:` references that read from the
 * trigger's outputs. For each, resolves the consumer node's input schema and
 * synthesizes an object schema describing what the trigger output must contain.
 *
 * Two reference shapes:
 *   - per-field:      in: { email: "TriggerId.body.email" }
 *                     contributes { properties.email: SaveUser.inputs.properties.email }
 *   - whole-object:   in: "TriggerId.body"
 *                     contributes the consumer's full inputs schema
 *
 * Multiple consumers of the same category merge their properties. On key
 * conflict, first writer wins (workflow is broken either way).
 */
export function discoverTriggerConsumers(
  workflow: WorkflowFile,
  triggerNodeId: string,
  schemas: Record<string, NodeSchemas>,
): ConsumedShapes {
  /* ... see implementation in the plan ... */
}
```

Algorithm:

1. Initialize `accum = { body: {properties: {}}, query: {properties: {}}, headers: {properties: {}} }` (raw maps; converted to schemas at the end)
2. For each node `[id, instance]` in `workflow.nodes` where `id !== triggerNodeId`:
   - Let `consumerSchema = schemas[instance.uses]`. Skip if undefined.
   - If `instance.in` is a string: parse it. If first segment is `triggerNodeId` and second is `body | query | headers`:
     - If exactly two segments (`TriggerId.body`): the consumer's whole `inputs` schema is the shape. Merge into `accum[category]`.
     - If three or more segments: the consumer's `inputs` IS what the trigger's `body.X` produces; but since the consumer is using whole-object form, this is ambiguous. Skip (rare; v2 can decide).
   - If `instance.in` is an object: for each `(field, ref)`:
     - Parse `ref`. If first segment matches `triggerNodeId` and second matches a category and exactly three segments:
       - `category = ref[1]`, `path = ref[2]`
       - Look up `consumerSchema.inputs.properties?.[field]` — if present, contribute as `accum[category].properties[path] = consumerSchema.inputs.properties[field]`
3. Convert each non-empty `accum[category]` into a JSON schema object `{ type: "object", properties: ... }`; otherwise null.

For deeper paths (`TriggerId.body.user.email`), v1 only handles depth-3 references (`TriggerId.body.email`). Deeper refs are skipped silently. Rationale: most workflows wire flat fields directly; nested-path inference is a complexity multiplier with limited gain. v2 can add it.

---

## 3. Sample generation — `sampleFromSchema`

`packages/ide/src/panels/run-tab/sample-from-schema.ts`:

```ts
import type { JsonSchema } from "@/lib/api"

/**
 * Generate a sample JS value from a JsonSchema. Used to pre-fill request
 * bodies / query / headers from inferred schemas. Returns `null` when the
 * schema is malformed or unrecognized.
 */
export function sampleFromSchema(schema: JsonSchema | null): unknown {
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

Properties:
- Pure function, no I/O
- Respects `default` over generated value
- Respects `enum` over type-based default
- Object recursion preserves key order
- Array is `[]` — v1 doesn't synthesize array items

---

## 4. TriggerSelector integration

`packages/ide/src/panels/run-tab/trigger-selector.tsx` changes:

### Schema fetch

Add local state and effect:

```ts
const [schemas, setSchemas] = useState<Record<string, NodeSchemas>>({})
useEffect(() => {
  let alive = true
  fetchWorkspaceSchemas()
    .then((s) => { if (alive) setSchemas(s) })
    .catch(() => {})
  return () => { alive = false }
}, [])
```

### `pickTrigger` becomes schema-aware

```ts
function pickTrigger(
  t: Trigger,
  workflow: WorkflowFile,
  schemas: Record<string, NodeSchemas>,
) {
  const consumed = discoverTriggerConsumers(workflow, t.nodeId, schemas)

  // Body
  const hasBodyShape = consumed.body !== null
  const bodyKind: BodyKind = hasBodyShape ? "json" : defaultBodyKindForMethod(t.method)
  const sampleBody = hasBodyShape ? sampleFromSchema(consumed.body) : null
  const bodyText = sampleBody !== null ? JSON.stringify(sampleBody, null, 2) : ""

  // Query: one row per discovered key
  const queryRows: Array<[string, string]> =
    consumed.query?.type === "object" && consumed.query.properties
      ? Object.keys(consumed.query.properties).map((k) => [k, ""])
      : []

  // Headers: one row per discovered key
  const headerRows: Array<[string, string]> = []
  if (consumed.headers?.type === "object" && consumed.headers.properties) {
    for (const k of Object.keys(consumed.headers.properties)) {
      headerRows.push([k, ""])
    }
  }
  // Content-Type auto-set when body has shape
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
```

### Wire up schemas in the existing effects

The two existing `pickTrigger(triggers[0]!)` call sites become `pickTrigger(triggers[0]!, workflow, schemas)`. The dropdown's `onChange` likewise passes `workflow` and `schemas`.

### Late-arriving schemas

When schemas finish loading after a trigger is already selected, re-fill (only if empty). New effect:

```ts
useEffect(() => {
  if (!workflow || !selected || Object.keys(schemas).length === 0) return
  const t = triggers.find((tr) => tr.nodeId === selected)
  if (t) pickTrigger(t, workflow, schemas)
  // pickTrigger's empty-check prevents clobbering when the user already typed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [schemas])
```

---

## 5. RequestBuilder — drop the method `<select>`

`packages/ide/src/panels/run-tab/request-builder.tsx`:

Replace the opening row's method dropdown with a read-only badge:

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

Delete the `METHODS` constant import + the `<select>` + its `onChange`. The `setRequestForm` import stays (still needed for the path input).

The method is set by `pickTrigger` — same value as the trigger declares. If a workflow's trigger doesn't declare a method, it falls back to `"GET"` (existing logic in `discoverTriggers`).

---

## 6. "Empty" semantics for the no-clobber guard

| Form field | "Empty" definition |
|---|---|
| `body` | `body.trim().length === 0` |
| `query` | `query.length === 0` |
| `headers` | `headers.length === 0` |

If the user types ANYTHING in the body (even whitespace then a character) we keep it. If they manually added a single query row (e.g. `["foo", ""]`) we keep that and don't add schema-derived rows. To re-trigger pre-fill, the user clears all rows in that section. Switching from trigger A to trigger B doesn't auto-clear — explicit user action is required.

---

## 7. Testing

### `discover-trigger-consumers.test.ts`

- per-field reference: `SaveUser.in.email = "Request.body.email"` → body schema `{ properties: { email: <SaveUser.inputs.properties.email> } }`
- whole-object reference: `Forward.in = "Request.body"` → body schema = `Forward.inputs`
- multiple consumers merge properties
- mixed shapes per category (e.g. body has two consumers, query has one) → both populated, independent
- reference to a different trigger output (`OtherTrigger.body.x`) → ignored
- missing consumer schema → consumer skipped silently
- deeper-than-3 reference (`Request.body.user.email`) → skipped (v1 limitation)
- empty workflow → all three return null
- workflow where nothing reads the trigger → all three return null

### `sample-from-schema.test.ts`

- string → `""`
- number/integer → `0`
- boolean → `false`
- array → `[]` (no items synthesized)
- object recurses
- enum → first value (string, number, mixed)
- default respects value (over enum, over type)
- null/undefined schema → null
- unknown `type` → null

### `trigger-selector.test.tsx` (extended)

- Single-trigger workflow with one consumer per category: body/query/headers pre-fill on mount
- Pre-fill is skipped when body is already typed (string content)
- Pre-fill is skipped when query has any row
- Switching workflows clears and re-fills
- Late-arriving schemas: pre-fill kicks in after `fetchWorkspaceSchemas` resolves
- Content-Type is auto-added when body has shape

### `request-builder.test.tsx`

- Method dropdown is gone (no `<select>` in the form)
- Method is rendered as a read-only badge with the form.method value
- Path input is still editable

---

## 8. File map

**Create:**
- `packages/ide/src/panels/run-tab/discover-trigger-consumers.ts`
- `packages/ide/src/panels/run-tab/discover-trigger-consumers.test.ts`
- `packages/ide/src/panels/run-tab/sample-from-schema.ts`
- `packages/ide/src/panels/run-tab/sample-from-schema.test.ts`

**Modify:**
- `packages/ide/src/panels/run-tab/trigger-selector.tsx` — local schemas fetch, `pickTrigger` enhanced, late-arrival effect
- `packages/ide/src/panels/run-tab/trigger-selector.test.tsx` — pre-fill cases
- `packages/ide/src/panels/run-tab/request-builder.tsx` — drop method `<select>`, render badge
- (Optional) Create `packages/ide/src/panels/run-tab/request-builder.test.tsx` — assert method badge + no select

---

## 9. Out-of-scope (v2+)

- Per-property smart fill (e.g. fill only `body.password` while leaving `body.email` user-edited)
- Nested-path reference inference beyond 3 segments
- Array item synthesis from `items` schema
- Header value templates (e.g. `Authorization: Bearer ` prefix)
- Path-param UI ("substitute `:id` for me")
- Centralized schemas store
- Re-fill button to manually regenerate from schema after user edits
