interface Props {
  pairs: Array<[string, string]>
  onChange: (next: Array<[string, string]>) => void
}

export function KeyValueGrid({ pairs, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      {pairs.map(([k, v], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and keys are edited in place
        <div key={i} className="flex min-w-0 items-center gap-1">
          <input
            placeholder="name"
            className="h-7 w-1/3 min-w-0 rounded-md border border-border bg-background px-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            value={k}
            onChange={(e) => {
              const next = [...pairs] as Array<[string, string]>
              next[i] = [e.target.value, v]
              onChange(next)
            }}
          />
          <input
            placeholder="value"
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            value={v}
            onChange={(e) => {
              const next = [...pairs] as Array<[string, string]>
              next[i] = [k, e.target.value]
              onChange(next)
            }}
          />
          <button
            type="button"
            className="shrink-0 px-1 text-muted-foreground hover:text-destructive"
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
            aria-label="remove"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="self-start whitespace-nowrap rounded-md px-1 py-0.5 text-primary hover:bg-accent"
        onClick={() => onChange([...pairs, ["", ""]])}
      >
        + add
      </button>
    </div>
  )
}
