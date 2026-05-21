import { useState } from "react"
import { Input } from "@/components/ui/input"
import type { NodeSchemas } from "@/lib/api"

interface Props {
  schemas: Record<string, NodeSchemas>
  onPick: (uses: string) => void
}

export function AddNodePalette({ schemas, onPick }: Props) {
  const [query, setQuery] = useState("")
  const items = Object.keys(schemas).sort(coreFirst)
  const filtered = query
    ? items.filter((k) => k.toLowerCase().includes(query.toLowerCase()))
    : items

  return (
    <div className="flex flex-col">
      <Input
        autoFocus
        placeholder="Search node types…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="m-2"
      />
      <div className="max-h-64 overflow-auto p-1">
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
        )}
        {filtered.map((uses) => {
          const color = schemas[uses]?.color
          return (
            <button
              type="button"
              key={uses}
              onClick={() => onPick(uses)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              {color && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: color }}
                />
              )}
              <span className="font-mono text-xs">{uses}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function coreFirst(a: string, b: string): number {
  const aCore = a.startsWith("@core/")
  const bCore = b.startsWith("@core/")
  if (aCore && !bCore) return -1
  if (!aCore && bCore) return 1
  return a.localeCompare(b)
}
