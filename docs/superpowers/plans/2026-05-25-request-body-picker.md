# Request Body Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Run-tab `RequestBuilder`'s JSON-only `<textarea>` with a body-type picker (JSON · XML · Text · Form · None), a Monaco-backed editor for text-based kinds, a key/value grid for form-urlencoded, and serialization on Send that mirrors how real HTTP traffic builds the trigger's body output.

**Architecture:** New `BodyTypeTabs` segmented control sits between the method/path row and the body input. A new `BodyEditor` component switches on `bodyKind` to render Monaco (json/xml/text) or `KeyValueGrid` (form) or nothing (none). The existing inline `KeyValueGrid` in `request-builder.tsx` is extracted into a shared module. `requestForm` gains `bodyKind` and `formBody` fields; `setRequestForm` is reused for all updates. The picker auto-manages the `Content-Type` header with a case-insensitive lookup that respects manual overrides.

**Tech Stack:** React 19, TypeScript ESM (NodeNext), Zustand (existing store), `@monaco-editor/react` v4.7 + `monaco-editor` v0.55 (already in `packages/ide`), Vitest + `@testing-library/react`, Tailwind. pnpm workspaces.

**Working dir:** `C:\Users\hello\source\cozy-api`. Branch: `main` (the previous feature branch was merged). The spec lives at `docs/superpowers/specs/2026-05-25-request-body-picker-design.md`. Read it for context.

---

## File map

**Create:**
- `packages/ide/src/panels/run-tab/key-value-grid.tsx` — extracted shared component
- `packages/ide/src/panels/run-tab/body-type-tabs.tsx` — segmented picker + Content-Type auto-set
- `packages/ide/src/panels/run-tab/body-type-tabs.test.tsx` — picker + Content-Type tests
- `packages/ide/src/panels/run-tab/body-editor.tsx` — Monaco / KeyValueGrid / null switch
- `packages/ide/src/panels/run-tab/body-editor.test.tsx` — switch + Monaco language tests

**Modify:**
- `packages/ide/src/store/debug-session.ts` — extend `requestForm` shape with `bodyKind` + `formBody`
- `packages/ide/src/store/debug-session.test.ts` — assert initial-state additions
- `packages/ide/src/panels/run-tab/request-builder.tsx` — remove inline `KeyValueGrid` + textarea; render new picker/editor; rewrite `SendButton` serialization
- `packages/ide/src/panels/run-tab/trigger-selector.tsx` — set `bodyKind` based on trigger method when (re)selecting

---

## Task 1: Extend `requestForm` store shape

**Files:**
- Modify: `packages/ide/src/store/debug-session.ts:58-92` (the `requestForm` interface + `initialRequestForm` constant)
- Modify: `packages/ide/src/store/debug-session.test.ts` (existing "starts idle with no runs" test asserts on initial state)

- [ ] **Step 1: Write the failing test**

Append to `packages/ide/src/store/debug-session.test.ts` (after the "starts idle with no runs" test):

```ts
it("requestForm initial state includes bodyKind='none' and formBody=[]", () => {
  const s = useDebugSessionStore.getState()
  expect(s.requestForm.bodyKind).toBe("none")
  expect(s.requestForm.formBody).toEqual([])
})

it("setRequestForm round-trips bodyKind and formBody", () => {
  useDebugSessionStore.getState().setRequestForm((cur) => ({
    ...cur,
    bodyKind: "json",
    formBody: [["k", "v"]],
  }))
  const s = useDebugSessionStore.getState()
  expect(s.requestForm.bodyKind).toBe("json")
  expect(s.requestForm.formBody).toEqual([["k", "v"]])
})
```

- [ ] **Step 2: Run to verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test debug-session -- --run 2>&1 | tail -20
```

Expected: two new tests FAIL — `bodyKind` doesn't exist on `requestForm` yet.

- [ ] **Step 3: Add `BodyKind` type alias and extend `requestForm`**

In `packages/ide/src/store/debug-session.ts`, near the other type aliases at the top of the file (after `NodeStatus` definition around line 13):

```ts
export type BodyKind = "none" | "json" | "xml" | "text" | "form"
```

In the `DebugSessionState` interface, change the `requestForm` field to:

```ts
requestForm: {
  triggerNodeId: string | null
  method: string
  path: string
  bodyKind: BodyKind
  body: string // raw JSON/XML/text content for the Monaco editor
  formBody: Array<[string, string]>
  query: Array<[string, string]>
  headers: Array<[string, string]>
}
```

And in the `initialRequestForm` constant:

```ts
const initialRequestForm: DebugSessionState["requestForm"] = {
  triggerNodeId: null,
  method: "GET",
  path: "/",
  bodyKind: "none",
  body: "",
  formBody: [],
  query: [],
  headers: [],
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test debug-session -- --run 2>&1 | tail -20
```

Expected: all debug-session tests green (existing + 2 new).

- [ ] **Step 5: Run typecheck (verify no callers broke)**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -15
```

Expected: clean. If `request-builder.tsx` or `trigger-selector.tsx` complain about missing `bodyKind`/`formBody` in their `setRequestForm` updaters, those are addressed in Tasks 5 and 6 respectively. **Defer those errors** — they are expected at this stage. If only those two files show errors, proceed; if any other file complains, stop and report.

If the existing callers in `trigger-selector.tsx` (which sets the form on trigger selection) and `request-builder.tsx` cause typecheck failures, add the new fields to those updaters as a SYNTAX-ONLY fix (no logic change) in this commit so the workspace stays green:

In `trigger-selector.tsx` lines 42-49 (the auto-select branch) and lines 78-85 (the change branch), add `bodyKind: "none", formBody: [],` to the updater literal so it satisfies the new shape. Task 6 will replace this with proper method-based default-selection.

- [ ] **Step 6: Commit**

```bash
git add packages/ide/src/store/debug-session.ts packages/ide/src/store/debug-session.test.ts packages/ide/src/panels/run-tab/trigger-selector.tsx
git commit -m "feat(ide): add bodyKind + formBody to requestForm state

Two new fields on the Run-tab request form: bodyKind selects the
body editor mode (none/json/xml/text/form) and formBody holds
url-encoded key/value pairs separately from the json/xml/text body
string, so toggling between kinds doesn't lose either set.

trigger-selector.tsx temporarily ships bodyKind: 'none' / formBody: []
in its form-reset updaters to keep the workspace green; Task 6
replaces those with method-based defaults.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Extract `KeyValueGrid` to a shared module

**Files:**
- Create: `packages/ide/src/panels/run-tab/key-value-grid.tsx`
- Modify: `packages/ide/src/panels/run-tab/request-builder.tsx:69-117` (remove the inline definition and import from the new module)

- [ ] **Step 1: Create the new module**

Create `packages/ide/src/panels/run-tab/key-value-grid.tsx` with the existing implementation:

```tsx
interface Props {
  pairs: Array<[string, string]>
  onChange: (next: Array<[string, string]>) => void
}

export function KeyValueGrid({ pairs, onChange }: Props) {
  return (
    <div className="mt-1 flex flex-col gap-1">
      {pairs.map(([k, v], i) => (
        <div key={i} className="flex gap-1">
          <input
            className="w-1/3 rounded-md border bg-background px-2 py-1 font-mono"
            value={k}
            onChange={(e) => {
              const next = [...pairs] as Array<[string, string]>
              next[i] = [e.target.value, v]
              onChange(next)
            }}
          />
          <input
            className="flex-1 rounded-md border bg-background px-2 py-1 font-mono"
            value={v}
            onChange={(e) => {
              const next = [...pairs] as Array<[string, string]>
              next[i] = [k, e.target.value]
              onChange(next)
            }}
          />
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
            aria-label="remove"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="self-start rounded-md border px-2 py-1 text-muted-foreground hover:text-foreground"
        onClick={() => onChange([...pairs, ["", ""]])}
      >
        + add
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Remove the inline `KeyValueGrid` from `request-builder.tsx` and import from the new module**

In `packages/ide/src/panels/run-tab/request-builder.tsx`:

1. Delete the entire `function KeyValueGrid(...)` declaration at lines ~69-117.
2. Add an import at the top:
   ```ts
   import { KeyValueGrid } from "./key-value-grid"
   ```

The two existing `<KeyValueGrid pairs=... onChange=... />` call sites (around lines 52-55 and 59-62 for headers and query respectively) work unchanged.

- [ ] **Step 3: Run tests + typecheck**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test 2>&1 | tail -15 && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: green. No behavior change, just extraction.

- [ ] **Step 4: Commit**

```bash
git add packages/ide/src/panels/run-tab/key-value-grid.tsx packages/ide/src/panels/run-tab/request-builder.tsx
git commit -m "refactor(ide): extract KeyValueGrid into its own module

Lifted the inline KeyValueGrid out of request-builder.tsx so it can
be reused by the upcoming BodyEditor's form-urlencoded mode without
duplication.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: `BodyTypeTabs` — segmented picker + Content-Type auto-set

**Files:**
- Create: `packages/ide/src/panels/run-tab/body-type-tabs.tsx`
- Create: `packages/ide/src/panels/run-tab/body-type-tabs.test.tsx`

This task implements the picker UI AND the Content-Type auto-management rule from §5 of the spec. The component is self-contained — it reads `bodyKind` and `headers` from the store and updates both atomically via `setRequestForm`.

- [ ] **Step 1: Write failing tests**

`packages/ide/src/panels/run-tab/body-type-tabs.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { useDebugSessionStore } from "@/store/debug-session"
import { BodyTypeTabs } from "./body-type-tabs"

describe("BodyTypeTabs", () => {
  afterEach(() => {
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState())
  })

  it("renders five tab buttons", () => {
    render(<BodyTypeTabs />)
    expect(screen.getByRole("button", { name: "JSON" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "XML" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Text" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Form" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "None" })).toBeInTheDocument()
  })

  it("clicking a tab updates requestForm.bodyKind", () => {
    render(<BodyTypeTabs />)
    fireEvent.click(screen.getByRole("button", { name: "JSON" }))
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("json")
    fireEvent.click(screen.getByRole("button", { name: "XML" }))
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("xml")
    fireEvent.click(screen.getByRole("button", { name: "Form" }))
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("form")
  })

  it("the active tab has a distinct aria-pressed='true'", () => {
    useDebugSessionStore.getState().setRequestForm((cur) => ({ ...cur, bodyKind: "xml" }))
    render(<BodyTypeTabs />)
    expect(screen.getByRole("button", { name: "XML" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "JSON" })).toHaveAttribute("aria-pressed", "false")
  })

  describe("Content-Type auto-set", () => {
    it("adds Content-Type when headers is empty and a kind is picked", () => {
      render(<BodyTypeTabs />)
      fireEvent.click(screen.getByRole("button", { name: "JSON" }))
      expect(useDebugSessionStore.getState().requestForm.headers).toEqual([
        ["Content-Type", "application/json"],
      ])
    })

    it("replaces an auto-set Content-Type with the new kind's value", () => {
      useDebugSessionStore.getState().setRequestForm((cur) => ({
        ...cur,
        bodyKind: "json",
        headers: [["Content-Type", "application/json"]],
      }))
      render(<BodyTypeTabs />)
      fireEvent.click(screen.getByRole("button", { name: "XML" }))
      expect(useDebugSessionStore.getState().requestForm.headers).toEqual([
        ["Content-Type", "application/xml"],
      ])
    })

    it("leaves a manually-overridden Content-Type untouched", () => {
      useDebugSessionStore.getState().setRequestForm((cur) => ({
        ...cur,
        bodyKind: "json",
        headers: [["Content-Type", "application/vnd.api+json"]],
      }))
      render(<BodyTypeTabs />)
      fireEvent.click(screen.getByRole("button", { name: "XML" }))
      expect(useDebugSessionStore.getState().requestForm.headers).toEqual([
        ["Content-Type", "application/vnd.api+json"],
      ])
    })

    it("removes an auto-set Content-Type when picking None", () => {
      useDebugSessionStore.getState().setRequestForm((cur) => ({
        ...cur,
        bodyKind: "json",
        headers: [["Content-Type", "application/json"]],
      }))
      render(<BodyTypeTabs />)
      fireEvent.click(screen.getByRole("button", { name: "None" }))
      expect(useDebugSessionStore.getState().requestForm.headers).toEqual([])
    })

    it("does NOT remove a manually-overridden Content-Type when picking None", () => {
      useDebugSessionStore.getState().setRequestForm((cur) => ({
        ...cur,
        bodyKind: "json",
        headers: [["Content-Type", "application/vnd.api+json"]],
      }))
      render(<BodyTypeTabs />)
      fireEvent.click(screen.getByRole("button", { name: "None" }))
      expect(useDebugSessionStore.getState().requestForm.headers).toEqual([
        ["Content-Type", "application/vnd.api+json"],
      ])
    })

    it("matches Content-Type header key case-insensitively", () => {
      useDebugSessionStore.getState().setRequestForm((cur) => ({
        ...cur,
        bodyKind: "json",
        headers: [["content-type", "application/json"]],
      }))
      render(<BodyTypeTabs />)
      fireEvent.click(screen.getByRole("button", { name: "XML" }))
      // The original case is preserved; only the value changes
      expect(useDebugSessionStore.getState().requestForm.headers).toEqual([
        ["content-type", "application/xml"],
      ])
    })

    it("preserves other headers untouched", () => {
      useDebugSessionStore.getState().setRequestForm((cur) => ({
        ...cur,
        bodyKind: "none",
        headers: [
          ["Authorization", "Bearer tok"],
          ["X-Trace", "abc"],
        ],
      }))
      render(<BodyTypeTabs />)
      fireEvent.click(screen.getByRole("button", { name: "JSON" }))
      const headers = useDebugSessionStore.getState().requestForm.headers
      expect(headers).toContainEqual(["Authorization", "Bearer tok"])
      expect(headers).toContainEqual(["X-Trace", "abc"])
      expect(headers).toContainEqual(["Content-Type", "application/json"])
    })
  })
})
```

- [ ] **Step 2: Verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test body-type-tabs -- --run 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BodyTypeTabs`**

`packages/ide/src/panels/run-tab/body-type-tabs.tsx`:

```tsx
import { useDebugSessionStore, type BodyKind } from "@/store/debug-session"
import { cn } from "@/lib/utils"

const TABS: Array<{ kind: BodyKind; label: string }> = [
  { kind: "json", label: "JSON" },
  { kind: "xml", label: "XML" },
  { kind: "text", label: "Text" },
  { kind: "form", label: "Form" },
  { kind: "none", label: "None" },
]

const CONTENT_TYPE_BY_KIND: Record<Exclude<BodyKind, "none">, string> = {
  json: "application/json",
  xml: "application/xml",
  text: "text/plain",
  form: "application/x-www-form-urlencoded",
}

const AUTO_VALUES: ReadonlySet<string> = new Set(Object.values(CONTENT_TYPE_BY_KIND))

/**
 * Return a new headers array updated for the new bodyKind per the spec's
 * Content-Type auto-set rule:
 *   - missing + next!==none → add CT entry with the new kind's value
 *   - present + value in AUTO_VALUES + next==="none" → drop the entry
 *   - present + value in AUTO_VALUES + next!=="none" → replace value
 *   - present + value NOT in AUTO_VALUES → leave untouched
 * Header-key matching is case-insensitive; the existing key's case is preserved.
 */
export function updateContentTypeHeader(
  headers: Array<[string, string]>,
  next: BodyKind,
): Array<[string, string]> {
  const idx = headers.findIndex(([k]) => k.toLowerCase() === "content-type")
  if (idx < 0) {
    if (next === "none") return headers
    return [...headers, ["Content-Type", CONTENT_TYPE_BY_KIND[next]]]
  }
  const [origKey, origVal] = headers[idx]!
  if (!AUTO_VALUES.has(origVal)) return headers // user override — leave alone
  if (next === "none") {
    return headers.filter((_, i) => i !== idx)
  }
  const out = [...headers] as Array<[string, string]>
  out[idx] = [origKey, CONTENT_TYPE_BY_KIND[next]]
  return out
}

export function BodyTypeTabs() {
  const bodyKind = useDebugSessionStore((s) => s.requestForm.bodyKind)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)

  const pick = (next: BodyKind) => {
    setRequestForm((cur) => ({
      ...cur,
      bodyKind: next,
      headers: updateContentTypeHeader(cur.headers, next),
    }))
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Body:</span>
      <div role="group" className="inline-flex overflow-hidden rounded-md border">
        {TABS.map((t) => {
          const active = bodyKind === t.kind
          return (
            <button
              key={t.kind}
              type="button"
              aria-pressed={active ? "true" : "false"}
              onClick={() => pick(t.kind)}
              className={cn(
                "px-2 py-1 border-l first:border-l-0 hover:bg-accent/30",
                active && "bg-accent text-accent-foreground",
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

**NOTE**: `cn` lives at `@/lib/utils` (verified — multiple existing panels import it from there).

- [ ] **Step 4: Verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test body-type-tabs -- --run 2>&1 | tail -25
```

Expected: all 11 tests green.

- [ ] **Step 5: Typecheck**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/ide/src/panels/run-tab/body-type-tabs.tsx packages/ide/src/panels/run-tab/body-type-tabs.test.tsx
git commit -m "feat(ide): BodyTypeTabs picker + Content-Type auto-set

Segmented control with five tabs (JSON / XML / Text / Form / None).
Clicking a tab updates requestForm.bodyKind AND adjusts the
Content-Type header per the spec's auto-set rule: adds when missing,
replaces when the current value is an auto value, leaves manual
overrides untouched, removes when picking None.

Header-key matching is case-insensitive (preserves the user's
original casing).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: `BodyEditor` — Monaco / KeyValueGrid / null switch

**Files:**
- Create: `packages/ide/src/panels/run-tab/body-editor.tsx`
- Create: `packages/ide/src/panels/run-tab/body-editor.test.tsx`

- [ ] **Step 1: Write failing tests**

`packages/ide/src/panels/run-tab/body-editor.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { useDebugSessionStore } from "@/store/debug-session"

// Mock @monaco-editor/react before importing BodyEditor so the mock module is hot.
vi.mock("@monaco-editor/react", () => ({
  default: (props: {
    defaultLanguage?: string
    value?: string
    height?: number | string
  }) => (
    <div
      data-testid="monaco-mock"
      data-language={props.defaultLanguage}
      data-value={props.value ?? ""}
      data-height={String(props.height ?? "")}
    />
  ),
}))

import { BodyEditor } from "./body-editor"

describe("BodyEditor", () => {
  afterEach(() => {
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState())
  })

  it("renders nothing for bodyKind='none'", () => {
    useDebugSessionStore.getState().setRequestForm((c) => ({ ...c, bodyKind: "none" }))
    const { container } = render(<BodyEditor />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders Monaco with defaultLanguage='json' for bodyKind='json'", () => {
    useDebugSessionStore.getState().setRequestForm((c) => ({
      ...c,
      bodyKind: "json",
      body: '{ "a": 1 }',
    }))
    render(<BodyEditor />)
    const ed = screen.getByTestId("monaco-mock")
    expect(ed).toHaveAttribute("data-language", "json")
    expect(ed).toHaveAttribute("data-value", '{ "a": 1 }')
  })

  it("renders Monaco with defaultLanguage='xml' for bodyKind='xml'", () => {
    useDebugSessionStore.getState().setRequestForm((c) => ({ ...c, bodyKind: "xml" }))
    render(<BodyEditor />)
    expect(screen.getByTestId("monaco-mock")).toHaveAttribute("data-language", "xml")
  })

  it("renders Monaco with defaultLanguage='plaintext' for bodyKind='text'", () => {
    useDebugSessionStore.getState().setRequestForm((c) => ({ ...c, bodyKind: "text" }))
    render(<BodyEditor />)
    expect(screen.getByTestId("monaco-mock")).toHaveAttribute("data-language", "plaintext")
  })

  it("renders KeyValueGrid for bodyKind='form' with current formBody rows", () => {
    useDebugSessionStore.getState().setRequestForm((c) => ({
      ...c,
      bodyKind: "form",
      formBody: [["x", "1"], ["y", "2"]],
    }))
    render(<BodyEditor />)
    // KeyValueGrid renders one row per pair with the value in an input.
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[]
    const values = inputs.map((i) => i.value)
    expect(values).toContain("x")
    expect(values).toContain("1")
    expect(values).toContain("y")
    expect(values).toContain("2")
  })
})
```

- [ ] **Step 2: Verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test body-editor -- --run 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BodyEditor`**

`packages/ide/src/panels/run-tab/body-editor.tsx`:

```tsx
import Editor from "@monaco-editor/react"
import { useDebugSessionStore, type BodyKind } from "@/store/debug-session"
import { useThemeStore } from "@/store/theme"
import { KeyValueGrid } from "./key-value-grid"

const LANGUAGE_BY_KIND: Record<"json" | "xml" | "text", string> = {
  json: "json",
  xml: "xml",
  text: "plaintext",
}

export function BodyEditor() {
  const bodyKind = useDebugSessionStore((s) => s.requestForm.bodyKind)
  const body = useDebugSessionStore((s) => s.requestForm.body)
  const formBody = useDebugSessionStore((s) => s.requestForm.formBody)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)
  const theme = useThemeStore((s) => s.theme)

  if (bodyKind === "none") return null

  if (bodyKind === "form") {
    return (
      <KeyValueGrid
        pairs={formBody}
        onChange={(next) => setRequestForm((c) => ({ ...c, formBody: next }))}
      />
    )
  }

  // json / xml / text — Monaco. Keyed by kind so React remounts when the
  // language switches; avoids a stale model on the same Monaco instance.
  return (
    <div className="overflow-hidden rounded-md border">
      <Editor
        key={bodyKind}
        height={160}
        defaultLanguage={LANGUAGE_BY_KIND[bodyKind as "json" | "xml" | "text"]}
        value={body}
        theme={theme === "dark" ? "vs-dark" : "vs"}
        onChange={(v) => setRequestForm((c) => ({ ...c, body: v ?? "" }))}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: "on",
        }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test body-editor -- --run 2>&1 | tail -20
```

Expected: all 5 tests green.

- [ ] **Step 5: Typecheck**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/ide/src/panels/run-tab/body-editor.tsx packages/ide/src/panels/run-tab/body-editor.test.tsx
git commit -m "feat(ide): BodyEditor — Monaco for json/xml/text, KeyValueGrid for form

Switches on requestForm.bodyKind:
- none  → renders nothing
- json  → Monaco with defaultLanguage='json'
- xml   → Monaco with defaultLanguage='xml'
- text  → Monaco with defaultLanguage='plaintext'
- form  → KeyValueGrid bound to requestForm.formBody

Monaco editor is keyed by bodyKind so React remounts on a language
switch (avoids stale models on the same Monaco instance). Theme
follows useThemeStore, matching the existing CodeEditor pattern.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Wire into `RequestBuilder` + rewrite `SendButton` serialization

**Files:**
- Modify: `packages/ide/src/panels/run-tab/request-builder.tsx`
- Create: `packages/ide/src/panels/run-tab/serialize-body.ts` — pure helper, testable in isolation
- Create: `packages/ide/src/panels/run-tab/serialize-body.test.ts`

Split the serialization into a pure helper so it's testable without mounting the SendButton.

- [ ] **Step 1: Write failing test for `serializeBody`**

`packages/ide/src/panels/run-tab/serialize-body.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { serializeBody } from "./serialize-body"

const baseForm = {
  triggerNodeId: "trig",
  method: "POST",
  path: "/x",
  bodyKind: "none" as const,
  body: "",
  formBody: [] as Array<[string, string]>,
  query: [] as Array<[string, string]>,
  headers: [] as Array<[string, string]>,
}

describe("serializeBody", () => {
  it("none → no body key", () => {
    expect(serializeBody({ ...baseForm, bodyKind: "none" })).toEqual({})
  })

  it("json empty → no body key", () => {
    expect(serializeBody({ ...baseForm, bodyKind: "json", body: "   " })).toEqual({})
  })

  it("json valid → parsed object", () => {
    expect(serializeBody({ ...baseForm, bodyKind: "json", body: '{ "a": 1 }' })).toEqual({
      body: { a: 1 },
    })
  })

  it("json invalid → error string", () => {
    const r = serializeBody({ ...baseForm, bodyKind: "json", body: "{ not json" })
    expect(r.body).toBeUndefined()
    expect(r.error).toBeTruthy()
  })

  it("xml → raw string body", () => {
    expect(
      serializeBody({ ...baseForm, bodyKind: "xml", body: "<x>1</x>" }),
    ).toEqual({ body: "<x>1</x>" })
  })

  it("xml empty → no body key", () => {
    expect(serializeBody({ ...baseForm, bodyKind: "xml", body: "" })).toEqual({})
  })

  it("text → raw string body (whitespace preserved)", () => {
    expect(
      serializeBody({ ...baseForm, bodyKind: "text", body: "  hello\n" }),
    ).toEqual({ body: "  hello\n" })
  })

  it("form → URL-encoded string, empty keys filtered", () => {
    expect(
      serializeBody({
        ...baseForm,
        bodyKind: "form",
        formBody: [
          ["a", "1"],
          ["", "skip"],
          ["b", "two words"],
        ],
      }),
    ).toEqual({ body: "a=1&b=two+words" })
  })

  it("form with no rows → no body key", () => {
    expect(serializeBody({ ...baseForm, bodyKind: "form", formBody: [] })).toEqual({})
  })
})
```

- [ ] **Step 2: Verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test serialize-body -- --run 2>&1 | tail -15
```

- [ ] **Step 3: Implement `serializeBody`**

`packages/ide/src/panels/run-tab/serialize-body.ts`:

```ts
import type { BodyKind } from "@/store/debug-session"

export interface RequestFormSnapshot {
  bodyKind: BodyKind
  body: string
  formBody: Array<[string, string]>
}

export interface SerializedBody {
  body?: unknown
  error?: string
}

/**
 * Convert the request-form body fields into the wire-level envelope body
 * for a debug `fire` message. Mirrors how server.ts:mountWorkflows builds
 * the trigger's body output from real HTTP traffic so a workflow sees the
 * same request.body shape for debug runs and production traffic.
 */
export function serializeBody(form: RequestFormSnapshot): SerializedBody {
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

- [ ] **Step 4: Verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test serialize-body -- --run 2>&1 | tail -15
```

Expected: 9/9 green.

- [ ] **Step 5: Rewrite `RequestBuilder` to use `BodyTypeTabs` + `BodyEditor` and `SendButton` to use `serializeBody`**

Replace the body of `packages/ide/src/panels/run-tab/request-builder.tsx` with:

```tsx
import { useState } from "react"
import type { ClientMessage, RequestEnvelope } from "@darrylondil/lorien-runtime"
import { useDebugSessionStore } from "@/store/debug-session"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useTabsStore } from "@/store/tabs"
import { useDebugTransport } from "@/hooks/use-debug-transport"
import { BodyTypeTabs } from "./body-type-tabs"
import { BodyEditor } from "./body-editor"
import { KeyValueGrid } from "./key-value-grid"
import { serializeBody } from "./serialize-body"

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

export function RequestBuilder() {
  const form = useDebugSessionStore((s) => s.requestForm)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)

  if (!form.triggerNodeId) {
    return null
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
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
      <BodyTypeTabs />
      <BodyEditor />
      <details className="text-muted-foreground">
        <summary>headers</summary>
        <KeyValueGrid
          pairs={form.headers}
          onChange={(headers) => setRequestForm((c) => ({ ...c, headers }))}
        />
      </details>
      <details className="text-muted-foreground">
        <summary>query</summary>
        <KeyValueGrid
          pairs={form.query}
          onChange={(query) => setRequestForm((c) => ({ ...c, query }))}
        />
      </details>
      <SendButton />
    </div>
  )
}

function SendButton() {
  const form = useDebugSessionStore((s) => s.requestForm)
  const status = useDebugSessionStore((s) => s.status)
  const recordFire = useDebugSessionStore((s) => s.recordFire)
  const liveTabId = useLiveWorkflowStore((s) => s.tabId)
  const tabs = useTabsStore((s) => s.tabs)
  const workflowPath = tabs.find((t) => t.id === liveTabId)?.path ?? ""
  const { send } = useDebugTransport()
  const [bodyError, setBodyError] = useState<string | null>(null)

  const inFlight = status === "running" || status === "paused"

  const onClick = () => {
    if (!form.triggerNodeId || !workflowPath) return
    const r = serializeBody(form)
    if (r.error !== undefined) {
      setBodyError(r.error)
      return
    }
    setBodyError(null)
    const envelope: RequestEnvelope = {
      method: form.method,
      path: form.path,
      ...(r.body !== undefined ? { body: r.body } : {}),
      ...(form.query.length > 0
        ? { query: Object.fromEntries(form.query.filter(([k]) => k.length > 0)) }
        : {}),
      ...(form.headers.length > 0
        ? { headers: Object.fromEntries(form.headers.filter(([k]) => k.length > 0)) }
        : {}),
    }
    recordFire(workflowPath, form.triggerNodeId, envelope)
    send({
      type: "fire",
      workflowPath,
      triggerNodeId: form.triggerNodeId,
      request: envelope,
    } satisfies ClientMessage)
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={inFlight || !form.triggerNodeId}
        className="rounded-md border bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        onClick={onClick}
      >
        Send
      </button>
      {bodyError && <span className="text-red-700">{bodyError}</span>}
    </div>
  )
}
```

NOTE: the inline `KeyValueGrid` function declaration is gone (was removed in Task 2) and the inline `<textarea>` body is replaced by `<BodyTypeTabs />` + `<BodyEditor />`. SendButton uses `serializeBody`; the JSON parse logic is removed from the click handler.

- [ ] **Step 6: Run tests + typecheck**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test 2>&1 | tail -15
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide typecheck 2>&1 | tail -10
```

Expected: green. If any existing `request-builder.test.tsx` test asserts on the old `<textarea>` or the `body (JSON)` label, update those tests in this commit to use the new structure. Specifically:
- A test asserting `screen.getByPlaceholderText('e.g. { "email": "a@b.com" }')` no longer applies — that textarea is gone.
- A test asserting `screen.getByText("body (JSON)")` no longer applies.
- If the existing test simulates JSON-error display by typing invalid JSON into the textarea and clicking Send, update it to set `bodyKind: "json"` + `body: "{not json"` directly on the store, then click Send and assert the error appears.

Look at `packages/ide/src/panels/run-tab/request-builder.test.tsx` (if it exists) and adapt accordingly. If no such test file exists, skip this paragraph.

- [ ] **Step 7: Commit**

```bash
git add packages/ide/src/panels/run-tab/request-builder.tsx packages/ide/src/panels/run-tab/serialize-body.ts packages/ide/src/panels/run-tab/serialize-body.test.ts
# If request-builder.test.tsx was edited, add it too
git commit -m "feat(ide): wire BodyTypeTabs + BodyEditor into RequestBuilder

Replaces the JSON-only textarea with the new picker and editor.
Extracts the body-to-envelope serialization into a pure helper
(serialize-body.ts) so it's testable in isolation. Send button now
displays a generic 'body error' message; JSON parse errors flow
through the same channel as future serialization errors.

The envelope's body field still mirrors how server.ts:mountWorkflows
builds the trigger's body output from real HTTP traffic:
JSON content-type → parsed object; anything else → raw string.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: `TriggerSelector` picks default `bodyKind` from method

**Files:**
- Modify: `packages/ide/src/panels/run-tab/trigger-selector.tsx`

Replace the placeholder `bodyKind: "none", formBody: []` (added in Task 1 to keep typecheck green) with the proper default based on the trigger's method.

- [ ] **Step 1: Write failing tests in a new test file**

`packages/ide/src/panels/run-tab/trigger-selector.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import { useDebugSessionStore } from "@/store/debug-session"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { TriggerSelector } from "./trigger-selector"
import type { WorkflowFile } from "@/lib/api"

const baseStoreReset = () => {
  useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState())
}

function setWorkflow(wf: WorkflowFile | null) {
  useLiveWorkflowStore.setState({ workflow: wf } as never)
}

describe("TriggerSelector default bodyKind", () => {
  beforeEach(baseStoreReset)
  afterEach(() => {
    baseStoreReset()
    setWorkflow(null)
  })

  it("single POST trigger → bodyKind='json'", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: {
          uses: "@core/http-request",
          values: { method: "POST", path: "/users" },
        },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("json")
  })

  it("single PUT trigger → bodyKind='json'", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { method: "PUT", path: "/u/1" } },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("json")
  })

  it("single PATCH trigger → bodyKind='json'", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { method: "PATCH", path: "/u/1" } },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("json")
  })

  it("single GET trigger → bodyKind='none'", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { method: "GET", path: "/u" } },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("none")
  })

  it("single DELETE trigger → bodyKind='none'", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { method: "DELETE", path: "/u/1" } },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("none")
  })

  it("trigger list becomes empty → bodyKind resets to 'none'", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { method: "POST", path: "/u" } },
      },
    } as unknown as WorkflowFile)
    const { rerender } = render(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("json")
    setWorkflow({ lorien: 1, nodes: {} } as unknown as WorkflowFile)
    rerender(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("none")
  })
})
```

- [ ] **Step 2: Verify FAIL**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test trigger-selector -- --run 2>&1 | tail -20
```

Expected: the "single POST/PUT/PATCH" cases FAIL (bodyKind is currently always "none" per the placeholder added in Task 1).

- [ ] **Step 3: Replace the placeholder with proper method-based defaults**

In `packages/ide/src/panels/run-tab/trigger-selector.tsx`, add a helper near the top of the file (after the `discoverTriggers` function):

```ts
function defaultBodyKindForMethod(method: string): "json" | "none" {
  const upper = method.toUpperCase()
  return upper === "POST" || upper === "PUT" || upper === "PATCH" ? "json" : "none"
}
```

Then in the two existing `setRequestForm(() => ({...}))` call sites (the single-trigger auto-select branch around lines 42-49 and the dropdown change branch around lines 78-85), include the bodyKind + Content-Type header:

```ts
const t = triggers[0]!
const bodyKind = defaultBodyKindForMethod(t.method)
const headers: Array<[string, string]> =
  bodyKind === "none" ? [] : [["Content-Type", "application/json"]]
setRequestForm(() => ({
  triggerNodeId: t.nodeId,
  method: t.method,
  path: t.path,
  bodyKind,
  body: "",
  formBody: [],
  query: [],
  headers,
}))
```

Apply the same pattern to the dropdown's `onChange` handler. The variable `t` should be the selected trigger from `triggers.find(...)`.

The form-reset case (when `triggers.length === 0`) at line 36-39 already does a partial `setRequestForm((cur) => ({ ...cur, triggerNodeId: null }))` — change it to a FULL reset so `bodyKind` returns to `"none"` and `headers` is cleared:

```ts
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
```

(The "selected not in current list" branch at lines 52-54 can stay as a partial update, since the next render with a new trigger will fully reset.)

- [ ] **Step 4: Verify PASS**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test trigger-selector -- --run 2>&1 | tail -20
```

Expected: 6/6 green.

- [ ] **Step 5: Run full IDE suite + typecheck + monorepo gate**

```bash
cd C:/Users/hello/source/cozy-api && pnpm --filter @darrylondil/lorien-ide test 2>&1 | tail -15
cd C:/Users/hello/source/cozy-api && pnpm -r typecheck 2>&1 | tail -15
cd C:/Users/hello/source/cozy-api && pnpm -r build 2>&1 | tail -15
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/ide/src/panels/run-tab/trigger-selector.tsx packages/ide/src/panels/run-tab/trigger-selector.test.tsx
git commit -m "feat(ide): TriggerSelector picks default bodyKind from trigger method

POST/PUT/PATCH triggers default to bodyKind='json' (with Content-Type
set to application/json); GET/DELETE default to bodyKind='none' with
no auto Content-Type. Empty trigger list resets the form completely.

This finishes the body-picker subsystem: the Run-tab user now sees a
JSON editor pre-populated for the common case of a POST trigger,
with the right Content-Type already in headers.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Final verification

After all six tasks land, run the full gate:

```bash
cd C:/Users/hello/source/cozy-api && pnpm -r test 2>&1 | tail -30
cd C:/Users/hello/source/cozy-api && pnpm -r typecheck 2>&1 | tail -20
cd C:/Users/hello/source/cozy-api && pnpm -r build 2>&1 | tail -20
```

Manual sanity check: start the IDE, open a workflow with a POST `@core/http-request` trigger, switch to the Run tab. The body picker should show JSON selected by default, Monaco should render with JSON highlighting, Content-Type `application/json` should appear in the headers section. Try toggling to XML/Text/Form/None to verify the Content-Type follows.

Out-of-scope items (multipart/form-data, custom MIME entry, body history, JSON schema autocomplete, gRPC modes) are deliberately not implemented in this plan.
