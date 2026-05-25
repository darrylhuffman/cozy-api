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
