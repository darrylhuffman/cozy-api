import type { Assertion, AssertionOp, AssertionTarget } from "@darrylondil/lorien-runtime/requests"

const TARGETS: Array<[AssertionTarget, string]> = [
  ["status", "Status"],
  ["body", "Body"],
  ["header", "Header"],
  ["duration", "Time (ms)"],
  ["node", "Node"],
]

const OPS: Array<[AssertionOp, string]> = [
  ["equals", "equals"],
  ["notEquals", "not equals"],
  ["contains", "contains"],
  ["exists", "exists"],
  ["notExists", "is missing"],
  ["matches", "matches regex"],
  ["lessThan", "<"],
  ["greaterThan", ">"],
  ["type", "is type"],
]

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

const needsPath = (t: AssertionTarget) => t === "body" || t === "header" || t === "node"
const needsValue = (op: AssertionOp) => op !== "exists" && op !== "notExists"

const field =
  "h-7 rounded-md border border-border bg-background px-1.5 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"

export function AssertionsEditor({
  value,
  nodeIds = [],
  onChange,
}: {
  value: Assertion[]
  /** Nodes a `Node` check can name. */
  nodeIds?: string[]
  onChange: (next: Assertion[]) => void
}) {
  const update = (i: number, patch: Partial<Assertion>) =>
    onChange(
      value.map((a, j) => {
        if (j !== i) return a
        const next: Assertion = { ...a, ...patch }
        if (patch.target === "node" && a.target !== "node") {
          // Start a node check as "<first node> ran".
          next.node = nodeIds[0] ?? ""
          next.op = "exists"
          delete next.path
        }
        if (next.target !== "node") delete next.node
        if (!needsPath(next.target)) delete next.path
        if (!needsValue(next.op)) delete next.value
        return next
      }),
    )

  return (
    <div className="flex flex-col gap-1.5" data-testid="assertions-editor">
      {value.length === 0 && (
        <div className="text-[11px] text-muted-foreground">
          No checks yet. Without checks a request passes on any status below 400.
        </div>
      )}
      {value.map((a, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and have no identity
          key={i}
          className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-1"
          data-testid="assertion-row"
        >
          <select
            aria-label="Check target"
            className={field}
            value={a.target}
            onChange={(e) => update(i, { target: e.target.value as AssertionTarget })}
          >
            {TARGETS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {a.target === "node" ? (
            <span />
          ) : needsPath(a.target) ? (
            <input
              aria-label={a.target === "header" ? "Header name" : "Body path"}
              placeholder={a.target === "header" ? "content-type" : "user.id (empty = whole body)"}
              className={`${field} min-w-0`}
              value={a.path ?? ""}
              onChange={(e) => update(i, { path: e.target.value })}
            />
          ) : (
            <span />
          )}
          <select
            aria-label="Check operator"
            className={field}
            value={a.op}
            onChange={(e) => update(i, { op: e.target.value as AssertionOp })}
          >
            {OPS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {!needsValue(a.op) ? (
            <span />
          ) : a.op === "type" ? (
            <select
              aria-label="Expected type"
              className={field}
              value={typeof a.value === "string" ? a.value : "string"}
              onChange={(e) => update(i, { value: e.target.value })}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label="Expected value"
              className={`${field} min-w-0`}
              value={formatValue(a.value)}
              onChange={(e) => update(i, { value: parseValue(e.target.value) })}
            />
          )}
          <button
            type="button"
            aria-label="Remove check"
            className="px-1 text-muted-foreground hover:text-destructive"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            ×
          </button>
          {a.target === "node" && (
            <div className="col-span-3 col-start-2 flex min-w-0 gap-1">
              <select
                aria-label="Checked node"
                className={field}
                value={a.node ?? ""}
                onChange={(e) => update(i, { node: e.target.value })}
              >
                {a.node !== undefined && !nodeIds.includes(a.node) && (
                  <option value={a.node}>{a.node || "node"}</option>
                )}
                {nodeIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <input
                aria-label="Node path"
                placeholder="output.id, input.name, error (empty = it ran)"
                className={`${field} min-w-0 flex-1`}
                value={a.path ?? ""}
                onChange={(e) => update(i, { path: e.target.value })}
              />
            </div>
          )}
        </div>
      ))}
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
