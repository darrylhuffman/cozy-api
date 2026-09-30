import type { Assertion, AssertionOp } from "@darrylondil/lorien-runtime/requests"
import { X } from "lucide-react"
import type { JsonSchema } from "@/lib/api"
import { scaffoldValue, unwrapSchema } from "@/workflow/variables"
import { type CheckShapes, opsFor, subjectSchema, typeName } from "./check-paths"
import { CheckSubject, type Subject } from "./check-subject"

const OP_LABEL: Record<AssertionOp, string> = {
  equals: "equals",
  notEquals: "doesn't equal",
  contains: "contains",
  matches: "matches regex",
  lessThan: "is less than",
  greaterThan: "is more than",
  exists: "exists",
  notExists: "is missing",
  type: "is a",
}

const TYPES = ["string", "number", "boolean", "object", "array", "null"]

/** Shows a value the way a person would type it: strings bare, everything else as JSON. */
export function formatValue(v: unknown): string {
  if (v === undefined) return ""
  return typeof v === "string" ? v : JSON.stringify(v)
}

/** Numbers, booleans, null, objects and arrays are read as JSON; anything else is a string. */
export function parseValue(text: string): unknown {
  const t = text.trim()
  if (t === "") return ""
  try {
    const v = JSON.parse(t)
    return typeof v === "string" ? text : v
  } catch {
    return text
  }
}

const needsValue = (op: AssertionOp) => op !== "exists" && op !== "notExists"

const EMPTY_SHAPES: CheckShapes = { body: undefined, headers: [], nodes: [] }

const field =
  "h-7 rounded-md border border-input bg-background px-2 font-mono text-[11.5px] focus:border-primary focus:outline-none"

/** A starting value that fits the schema, for when a check starts reading something new. */
function startValue(schema: JsonSchema | undefined, a: Assertion): unknown {
  if (a.op === "type") return typeName(schema) === "enum" ? "string" : typeName(schema) || "string"
  if (a.target === "status") return 200
  const s = unwrapSchema(schema)
  if (!s || typeName(s) === "") return a.value ?? ""
  return scaffoldValue(s)
}

function fits(schema: JsonSchema | undefined, v: unknown): boolean {
  const t = typeName(schema)
  if (t === "") return true
  if (t === "enum") return (unwrapSchema(schema)?.enum ?? []).some((e) => e === v)
  if (t === "array") return Array.isArray(v)
  if (t === "object") return v !== null && typeof v === "object" && !Array.isArray(v)
  return typeof v === t
}

/**
 * The checks on a saved request, one card each: what it reads (picked from
 * the response's or a node's shape), how it compares, and the value it
 * expects, with an editor that fits the field's type.
 */
export function AssertionsEditor({
  value,
  shapes = EMPTY_SHAPES,
  onChange,
}: {
  value: Assertion[]
  /** The shapes of the body, headers and nodes a check can read. */
  shapes?: CheckShapes
  onChange: (next: Assertion[]) => void
}) {
  const replace = (i: number, next: Assertion) => {
    if (!needsValue(next.op)) delete next.value
    if (next.target !== "node") delete next.node
    if (next.target === "status" || next.target === "duration") delete next.path
    onChange(value.map((a, j) => (j === i ? next : a)))
  }

  const setSubject = (i: number, a: Assertion, s: Subject) => {
    const next: Assertion = { ...a, target: s.target }
    if (s.path === undefined || s.path === "") delete next.path
    else next.path = s.path
    if (s.node !== undefined) next.node = s.node
    const schema = subjectSchema(next, shapes)
    const ops = opsFor(schema)
    if (!ops.includes(next.op)) next.op = ops[0]!
    if (
      needsValue(next.op) &&
      next.op !== "matches" &&
      !fits(next.op === "type" ? undefined : schema, next.value)
    ) {
      next.value = startValue(schema, next)
    }
    replace(i, next)
  }

  const setOp = (i: number, a: Assertion, op: AssertionOp) => {
    const next: Assertion = { ...a, op }
    if (op === "type") next.value = startValue(subjectSchema(a, shapes), next)
    else if (a.op === "type" || a.value === undefined)
      next.value = startValue(subjectSchema(a, shapes), next)
    replace(i, next)
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="assertions-editor">
      {value.length === 0 && (
        <div className="text-[11px] text-muted-foreground">
          No checks yet. Without checks a request passes on any status below 400.
        </div>
      )}
      {value.map((a, i) => {
        const schema = subjectSchema(a, shapes)
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and have no identity
            key={i}
            className="group flex flex-col gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5"
            data-testid="assertion-row"
          >
            <div className="flex min-w-0 items-start gap-1">
              <CheckSubject
                value={{ target: a.target, path: a.path, node: a.node }}
                shapes={shapes}
                hint={a.target === "duration" ? "ms" : typeName(schema) || undefined}
                onChange={(s) => setSubject(i, a, s)}
              />
              <button
                type="button"
                aria-label="Remove check"
                className="rounded p-0.5 text-muted-foreground opacity-60 hover:bg-accent hover:text-destructive group-hover:opacity-100"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <select
                aria-label="Check operator"
                className={`${field} shrink-0 font-sans`}
                value={a.op}
                onChange={(e) => setOp(i, a, e.target.value as AssertionOp)}
              >
                {opsFor(schema, a.op).map((op) => (
                  <option key={op} value={op}>
                    {OP_LABEL[op]}
                  </option>
                ))}
              </select>
              {needsValue(a.op) && (
                <ValueInput
                  assertion={a}
                  schema={schema}
                  onChange={(v) => replace(i, { ...a, value: v })}
                />
              )}
            </div>
          </div>
        )
      })}
      <button
        type="button"
        className="self-start whitespace-nowrap rounded-md px-1 py-0.5 text-xs text-primary hover:bg-accent"
        onClick={() => onChange([...value, { target: "status", op: "equals", value: 200 }])}
      >
        + Add check
      </button>
    </div>
  )
}

/** The expected value, edited the way its field's type suggests. */
function ValueInput({
  assertion: a,
  schema,
  onChange,
}: {
  assertion: Assertion
  schema: JsonSchema | undefined
  onChange: (v: unknown) => void
}) {
  const cls = `${field} min-w-0 flex-1`
  if (a.op === "type") {
    return (
      <select
        aria-label="Expected type"
        className={cls}
        value={typeof a.value === "string" ? a.value : "string"}
        onChange={(e) => onChange(e.target.value)}
      >
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    )
  }
  const kind = a.op === "matches" ? "string" : typeName(schema)
  const options =
    kind === "enum" ? (unwrapSchema(schema)?.enum ?? []) : kind === "boolean" ? [true, false] : null
  if (options && (a.op === "equals" || a.op === "notEquals")) {
    const idx = options.indexOf(a.value)
    return (
      <select
        aria-label="Expected value"
        className={cls}
        value={idx < 0 ? "" : String(idx)}
        onChange={(e) => onChange(options[Number(e.target.value)])}
      >
        {idx < 0 && <option value="">{formatValue(a.value) || "pick a value"}</option>}
        {options.map((o, j) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: enum options are positional
          <option key={j} value={String(j)}>
            {formatValue(o)}
          </option>
        ))}
      </select>
    )
  }
  const text = kind === "string" && typeof a.value === "string" ? a.value : formatValue(a.value)
  return (
    <input
      aria-label="Expected value"
      className={cls}
      inputMode={kind === "number" ? "decimal" : undefined}
      placeholder={
        a.op === "matches"
          ? "^pet-\\d+$"
          : kind === "number"
            ? "0"
            : kind === "array" || kind === "object"
              ? "JSON"
              : "expected value"
      }
      value={text}
      // Strings stay strings; other fields read numbers, booleans and JSON.
      onChange={(e) => onChange(kind === "string" ? e.target.value : parseValue(e.target.value))}
    />
  )
}
