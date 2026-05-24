import { useDebugSessionStore } from "@/store/debug-session"

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

export function RequestBuilder() {
  const form = useDebugSessionStore((s) => s.requestForm)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)

  if (!form.triggerNodeId) {
    // TriggerSelector renders the empty-state message; we just hide here.
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
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">body (JSON)</span>
        <textarea
          className="h-24 rounded-md border bg-background p-2 font-mono"
          value={form.body}
          onChange={(e) => setRequestForm((c) => ({ ...c, body: e.target.value }))}
          placeholder='e.g. { "email": "a@b.com" }'
          data-testid="request-body"
        />
      </label>
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
    </div>
  )
}

function KeyValueGrid({
  pairs,
  onChange,
}: {
  pairs: Array<[string, string]>
  onChange: (next: Array<[string, string]>) => void
}) {
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
