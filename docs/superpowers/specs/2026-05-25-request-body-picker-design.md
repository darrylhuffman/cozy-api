# Request body picker + Monaco editor — design

**Date:** 2026-05-25
**Subsystem:** IDE Run tab (extends subsystem #7, debugger)
**Status:** brainstorm complete, ready for implementation planning

---

## 1. Goal

Replace the Run-tab `RequestBuilder`'s plain JSON `<textarea>` with a richer body input: a content-type picker (`JSON · XML · Text · Form · None`) plus a Monaco-backed editor for text-based modes, a key/value grid for form-urlencoded, and proper serialization on Send. Auto-manages the `Content-Type` request header.

### In scope

- Five body kinds: `none`, `json`, `xml`, `text`, `form`
- Monaco editor for `json` / `xml` / `text` with the matching `defaultLanguage`
- Key/value grid for `form` (separate state from the text body so toggling preserves data)
- Auto-set `Content-Type` header on kind change, respecting manual overrides
- Send-side serialization that mirrors the real-HTTP code path's body parsing
- Default `bodyKind` chosen from the trigger's method (POST/PUT/PATCH → `json`, GET/DELETE → `none`)

### Deferred

- `multipart/form-data` (file uploads)
- Custom MIME types other than the four hardcoded auto-Content-Types
- Inline JSON lint UI beyond Monaco's built-in syntax underlining
- Body templates / saved bodies / history

---

## 2. State changes — `requestForm`

`packages/ide/src/store/debug-session.ts` extends the `requestForm` shape:

```ts
requestForm: {
  triggerNodeId: string | null
  method: string
  path: string
  bodyKind: "none" | "json" | "xml" | "text" | "form"  // NEW
  body: string                                         // reused: JSON/XML/text content
  formBody: Array<[string, string]>                    // NEW: form-urlencoded pairs
  query: Array<[string, string]>
  headers: Array<[string, string]>
}
```

`formBody` is intentionally separate from `body` so a user who types a JSON payload, switches to Form to tweak, then switches back does not lose either set.

Initial values: `bodyKind: "none"`, `body: ""`, `formBody: []`.

The `setRequestForm` action signature is unchanged (it's already an updater function).

---

## 3. Default `bodyKind` selection

When `TriggerSelector` auto-selects a trigger (`triggers.length === 1`) or the user picks one from the dropdown:

```ts
const defaultBodyKind = (method: string): BodyKind =>
  (["POST", "PUT", "PATCH"].includes(method.toUpperCase())) ? "json" : "none"
```

The selected trigger's method determines `bodyKind` at selection time. The Content-Type header is also set/cleared in the same update per the rule in §5.

Changing the method dropdown manually does NOT change `bodyKind` — that would surprise users mid-edit. The user can switch body kind explicitly via the picker.

When the trigger list becomes empty (e.g. workflow has no `@core/http-request` nodes), the form resets to defaults.

---

## 4. Components

### 4.1 `BodyTypeTabs` (new)

`packages/ide/src/panels/run-tab/body-type-tabs.tsx` — small segmented control:

```
Body:  [ JSON | XML | Text | Form | None ]
```

Backed by buttons styled as a tabset. Clicking a tab calls a callback that flips `bodyKind` AND applies the Content-Type rule (§5).

### 4.2 `BodyEditor` (new)

`packages/ide/src/panels/run-tab/body-editor.tsx` — switch component:

- `bodyKind === "none"` → renders nothing
- `bodyKind === "form"` → renders `<KeyValueGrid>` bound to `formBody`
- `bodyKind === "json" | "xml" | "text"` → renders `<Editor>` from `@monaco-editor/react` with:
  - `defaultLanguage`: `"json"`, `"xml"`, or `"plaintext"`
  - `value`: `form.body`
  - `onChange`: updates `body` via `setRequestForm`
  - `height`: 160px (taller than the previous 96px textarea, comfortable for typing a payload)
  - `theme`: derived from `useThemeStore` like `<CodeEditor>`
  - `options`: `{ minimap: { enabled: false }, fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, wordWrap: "on" }`

When `bodyKind` switches between Monaco-backed kinds, the editor key is the kind so React fully remounts — avoids stale language model on the same Monaco instance.

### 4.3 `KeyValueGrid` (refactor — extract)

The existing inline `KeyValueGrid` in `request-builder.tsx` moves to `packages/ide/src/panels/run-tab/key-value-grid.tsx` and is now exported. Callers: `RequestBuilder` (headers + query, unchanged usage) and `BodyEditor` (when `bodyKind === "form"`).

No behavior change — just a file move + export.

### 4.4 `RequestBuilder` changes

In `packages/ide/src/panels/run-tab/request-builder.tsx`:

- The body `<textarea>` is removed.
- A new section renders below the method/path row:
  ```
  <BodyTypeTabs />
  <BodyEditor />
  ```
- The headers/query `<details>` sections stay below the body area, now using the extracted `KeyValueGrid`.
- The `SendButton` JSON-parse logic is replaced with the serialization table in §6.

The Send button's disabled-while-running and trigger-required behavior is unchanged.

---

## 5. Content-Type header auto-set rule

Hardcoded mapping:

```ts
const CONTENT_TYPE_BY_KIND: Record<Exclude<BodyKind, "none">, string> = {
  json: "application/json",
  xml: "application/xml",
  text: "text/plain",
  form: "application/x-www-form-urlencoded",
}

const AUTO_VALUES: ReadonlySet<string> = new Set(Object.values(CONTENT_TYPE_BY_KIND))
```

When `bodyKind` changes to a new value `next`:

```
find Content-Type entry (case-insensitive key match) in requestForm.headers:
  - if missing and next !== "none"  → add ["Content-Type", CONTENT_TYPE_BY_KIND[next]]
  - if present and current value in AUTO_VALUES:
      - if next === "none"           → remove the entry
      - else                          → replace with CONTENT_TYPE_BY_KIND[next]
  - if present and current value NOT in AUTO_VALUES (user override):
      - leave the entry untouched
```

This is a pure transformation on the headers array, applied inside the `setRequestForm` updater that also writes `bodyKind`.

Header-key matching is case-insensitive (`"content-type"` and `"Content-Type"` both match) — match real HTTP header semantics.

---

## 6. Send-side serialization

`SendButton` (inside `RequestBuilder`) replaces the current `JSON.parse(form.body)` block with:

```ts
function serializeBody(form: RequestForm): { body?: unknown; error?: string } {
  switch (form.bodyKind) {
    case "none":
      return {}
    case "json": {
      const trimmed = form.body.trim()
      if (trimmed.length === 0) return {}
      try {
        return { body: JSON.parse(trimmed) }
      } catch (e) {
        return { error: (e as Error).message }
      }
    }
    case "xml":
    case "text":
      return form.body.length > 0 ? { body: form.body } : {}
    case "form": {
      const params = new URLSearchParams()
      for (const [k, v] of form.formBody) {
        if (k.length === 0) continue
        params.append(k, v)
      }
      const s = params.toString()
      return s.length > 0 ? { body: s } : {}
    }
  }
}
```

On parse error, set the `jsonError` state and bail (matches existing behavior).

On success, the envelope's `body` is set per the table above; the result is passed unchanged to `recordFire` + the WS `fire` message.

This mirrors how the real-HTTP path in `packages/runtime/src/dev-server/server.ts:mountWorkflows` builds the trigger's `body` output:

- `Content-Type: application/json` → parsed object
- Anything else → raw text string

So a workflow that reads `request.body` sees the same shape for debug runs and production traffic, regardless of which body kind the user picked.

---

## 7. Testing

Add to `packages/ide/src/store/debug-session.test.ts`:

- `bodyKind` and `formBody` are part of the initial `requestForm` state
- Setting `bodyKind` via `setRequestForm` round-trips correctly
- (Content-Type auto-set isn't tested at the store layer — it's in the picker component's onClick handler)

Add `packages/ide/src/panels/run-tab/body-type-tabs.test.tsx`:

- Renders five tabs
- Clicking a tab updates `requestForm.bodyKind` in the store
- Clicking JSON tab when no Content-Type header exists adds one with `application/json`
- Clicking XML tab when Content-Type is `application/json` (auto) replaces with `application/xml`
- Clicking JSON tab when Content-Type is `application/grpc+json` (manual override) leaves it untouched
- Clicking None tab when Content-Type is auto-set removes the header
- Header-key matching is case-insensitive (a header keyed `content-type` is still recognized as the Content-Type)

Add `packages/ide/src/panels/run-tab/body-editor.test.tsx`:

- `bodyKind === "none"` → renders no editor
- `bodyKind === "form"` → renders a `KeyValueGrid` bound to `formBody`
- `bodyKind === "json"` → renders Monaco with `defaultLanguage="json"` (mock the `@monaco-editor/react` Editor to assert on props)
- `bodyKind === "xml"` → `defaultLanguage="xml"`
- `bodyKind === "text"` → `defaultLanguage="plaintext"`

Extract-and-export the existing `KeyValueGrid` to its own file with no behavior change. The existing tests that cover headers + query inputs in `request-builder` (if any) should keep passing without modification.

Send-side serialization unit:

- Add to `request-builder.test.tsx` (or a dedicated `send-button.test.tsx` if RequestBuilder gets too crowded):
  - `none` → envelope omits body
  - `json` valid → object body
  - `json` invalid → Send blocked, error visible
  - `xml` / `text` → string body
  - `form` → URL-encoded string body, empty keys filtered out
  - `form` with no rows → envelope omits body

---

## 8. File map

**Create:**
- `packages/ide/src/panels/run-tab/key-value-grid.tsx` — extracted from `request-builder.tsx`
- `packages/ide/src/panels/run-tab/body-type-tabs.tsx` — segmented picker
- `packages/ide/src/panels/run-tab/body-type-tabs.test.tsx`
- `packages/ide/src/panels/run-tab/body-editor.tsx` — Monaco + form switch
- `packages/ide/src/panels/run-tab/body-editor.test.tsx`

**Modify:**
- `packages/ide/src/store/debug-session.ts` — add `bodyKind` + `formBody` to `requestForm`
- `packages/ide/src/store/debug-session.test.ts` — initial-state assertion
- `packages/ide/src/panels/run-tab/request-builder.tsx` — remove inline `KeyValueGrid` and textarea; add `<BodyTypeTabs />` + `<BodyEditor />`; update `SendButton` serialization
- `packages/ide/src/panels/run-tab/trigger-selector.tsx` — set `bodyKind` based on the picked trigger's method
- `packages/ide/src/panels/run-tab/request-builder.test.tsx` (or new `send-button.test.tsx`) — serialization coverage

---

## 9. Out-of-scope (v2+)

- `multipart/form-data` with file inputs
- Custom MIME type entry beyond the four auto-set values
- Body history / saved payloads
- JSON schema-aware autocomplete based on the trigger's downstream node inputs
- gRPC / Protobuf / GraphQL-specific body modes
- Pretty/minify buttons inside the JSON editor (Monaco's right-click already has Format Document)
