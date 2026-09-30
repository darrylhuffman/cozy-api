import type { MockRow } from "./saved-request-form"

const field =
  "h-7 rounded-md border border-border bg-background px-1.5 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"

/**
 * Node mocks for a saved request: each row makes one node return the given
 * JSON (or throw the given message) instead of running, for this request only.
 */
export function MocksEditor({
  value,
  nodeIds,
  onChange,
}: {
  value: MockRow[]
  /** Nodes that can be mocked (the workflow's own nodes, not triggers or responses). */
  nodeIds: string[]
  onChange: (next: MockRow[]) => void
}) {
  const update = (i: number, patch: Partial<MockRow>) =>
    onChange(value.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  const unused = nodeIds.find((id) => !value.some((row) => row.node === id))

  return (
    <div className="flex flex-col gap-1.5" data-testid="mocks-editor">
      <div className="text-[11px] text-muted-foreground">
        A mocked node skips its code and returns this instead, so a test can cover paths like a
        missing record or a failing database. Only the IDE and <code>lorien test</code> apply mocks.
      </div>
      {value.map((row, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and have no identity
          key={i}
          className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-1"
          data-testid="mock-row"
        >
          <select
            aria-label="Mocked node"
            className={field}
            value={row.node}
            onChange={(e) => update(i, { node: e.target.value })}
          >
            {!nodeIds.includes(row.node) && <option value={row.node}>{row.node || "node"}</option>}
            {nodeIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <select
            aria-label="Mock kind"
            className={field}
            value={row.kind}
            onChange={(e) =>
              update(i, {
                kind: e.target.value as MockRow["kind"],
                text: e.target.value === "error" ? "Something went wrong" : "{}",
              })
            }
          >
            <option value="output">returns</option>
            <option value="error">throws</option>
          </select>
          <input
            aria-label={row.kind === "error" ? "Error message" : "Mocked output (JSON)"}
            placeholder={row.kind === "error" ? "database is locked" : '{ "pet": null }'}
            className={`${field} min-w-0`}
            value={row.text}
            onChange={(e) => update(i, { text: e.target.value })}
          />
          <button
            type="button"
            aria-label="Remove mock"
            className="px-1 text-muted-foreground hover:text-destructive"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={!unused}
        className="self-start whitespace-nowrap rounded-md px-1 py-0.5 text-xs text-primary hover:bg-accent disabled:opacity-40"
        onClick={() => unused && onChange([...value, { node: unused, kind: "output", text: "{}" }])}
      >
        + Add mock
      </button>
    </div>
  )
}
