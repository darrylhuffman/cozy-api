import { cn } from "@/lib/utils"
import { type BodyKind, useDebugSessionStore } from "@/store/debug-session"

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
    <fieldset
      aria-label="Body type"
      className="m-0 inline-flex min-w-0 self-start rounded-md border-0 bg-muted p-0.5 text-xs"
    >
      {TABS.map((t) => {
        const active = bodyKind === t.kind
        return (
          <button
            key={t.kind}
            type="button"
            aria-pressed={active ? "true" : "false"}
            onClick={() => pick(t.kind)}
            className={cn(
              "whitespace-nowrap rounded px-2 py-0.5 transition-colors",
              active
                ? "bg-background font-semibold text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        )
      })}
    </fieldset>
  )
}
