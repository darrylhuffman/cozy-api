import { Check, ChevronRight, Folder, Search } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { methodTone } from "@/panels/run-tab/method-tone"
import { KindGlyph } from "./glyphs"
import { shapeColor } from "./map-canvas"
import type { AppMap, MapItem, MapKind, MiddlewareItem, NodeItem, ProviderItem } from "./model"
import { matchesQuery } from "./model"
import type { MapView } from "./prefs"

export const KIND_LABELS: Record<MapKind, string> = {
  workflow: "Workflows",
  node: "Nodes",
  middleware: "Middleware",
  provider: "Providers",
}
const KIND_ORDER: MapKind[] = ["workflow", "node", "middleware", "provider"]

export interface MapSidebarProps {
  map: AppMap
  view: MapView
  query: string
  onQuery(q: string): void
  kinds: ReadonlySet<MapKind>
  onToggleKind(kind: MapKind): void
  focus: ReadonlySet<string>
  onToggleFocus(key: string): void
  group: boolean
  onGroup(on: boolean): void
  outlines: boolean
  onOutlines(on: boolean): void
  onHover(key: string | null): void
  /** Enter in the search box: select the first match. */
  onSubmitQuery(): void
}

export function MapSidebar(props: MapSidebarProps) {
  const { map, query, focus } = props
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["workflows", "nodes"]))
  const searching = query.trim().length > 0
  const isOpen = (path: string) => searching || expanded.has(path)
  const toggle = (path: string) =>
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const row = (
    key: string,
    depth: number,
    content: React.ReactNode,
    meta: React.ReactNode,
    chevron?: string,
  ) => (
    <div key={key} className="flex items-center" style={{ paddingLeft: depth * 14 }}>
      {chevron !== undefined ? (
        <button
          type="button"
          aria-expanded={isOpen(chevron)}
          aria-label={`${isOpen(chevron) ? "Collapse" : "Expand"} ${chevron}`}
          onClick={() => toggle(chevron)}
          className="flex h-6 w-[18px] shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            className={cn("h-3 w-3 transition-transform", isOpen(chevron) && "rotate-90")}
          />
        </button>
      ) : (
        <span className="w-[18px] shrink-0" />
      )}
      <button
        type="button"
        aria-pressed={focus.has(key)}
        title={focus.has(key) ? "Stop focusing on this" : "Focus the map on this"}
        onClick={() => props.onToggleFocus(key)}
        onPointerEnter={() => props.onHover(key)}
        onPointerLeave={() => props.onHover(null)}
        className={cn(
          "flex min-h-[26px] min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-[12.5px] hover:bg-accent",
          focus.has(key) && "bg-primary/15 hover:bg-primary/20",
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">{content}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{meta}</span>
        <Check className={cn("h-3 w-3 shrink-0 text-primary", !focus.has(key) && "invisible")} />
      </button>
    </div>
  )

  const itemContent = (it: MapItem) => (
    <>
      <KindGlyph
        kind={it.kind}
        color={shapeColor({ item: it, kind: it.kind } as never)}
        method={it.kind === "workflow" ? it.method : null}
      />
      {it.kind === "workflow" ? (
        <span className="truncate">
          {it.method && (
            <span
              className={cn(
                "mr-1 rounded px-1 font-mono text-[10.5px] font-semibold",
                methodTone(it.method),
              )}
              style={{ backgroundColor: "color-mix(in srgb, currentColor 15%, transparent)" }}
            >
              {it.method}
            </span>
          )}
          <span className="font-mono">{it.route}</span>
        </span>
      ) : (
        <span className={cn("truncate", it.kind === "provider" && "font-mono")}>{it.label}</span>
      )}
    </>
  )
  const itemMeta = (it: MapItem): string => {
    if (it.kind === "node") {
      const n = new Set((it as NodeItem).usedBy.map((u) => u.workflow)).size
      return n ? `${n}×` : "unused"
    }
    if (it.kind === "provider") return (it as ProviderItem).info.lifetime
    if (it.kind === "middleware") return `${(it as MiddlewareItem).folder}/`
    return ""
  }

  const folderRows = (path: string, depth: number, kind: MapKind): React.ReactNode[] => {
    const f = map.folders.get(path)
    if (!f) return []
    const members = f.members
      .map((k) => map.byKey.get(k))
      .filter((m): m is MapItem => !!m && m.kind === kind)
    if (!members.length) return []
    if (searching && !members.some((m) => matchesQuery(m, query))) return []
    const rows: React.ReactNode[] = [
      row(
        f.key,
        depth,
        <>
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono">{f.name}/</span>
        </>,
        members.length,
        path,
      ),
    ]
    if (!isOpen(path)) return rows
    for (const child of f.children) rows.push(...folderRows(child, depth + 1, kind))
    for (const m of members) {
      if (m.folder !== path || (searching && !matchesQuery(m, query))) continue
      rows.push(row(m.key, depth + 1, itemContent(m), itemMeta(m)))
    }
    return rows
  }

  return (
    <aside
      aria-label="Map filters"
      className="flex h-full min-h-0 flex-col border-r border-border bg-card"
    >
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Filter the map
        </div>
        <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-2 text-muted-foreground focus-within:border-primary">
          <Search className="h-3.5 w-3.5" />
          <span className="sr-only">Search the map</span>
          <input
            type="search"
            value={query}
            placeholder="Find a node, route, provider…"
            onChange={(e) => props.onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") props.onSubmitQuery()
              if (e.key === "Escape") props.onQuery("")
            }}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <Toggle
          label="Group by folder"
          hint="One bubble per folder"
          on={props.group}
          onChange={props.onGroup}
        />
        <Toggle
          label="Folder outlines"
          hint={`In the ${props.view === "lanes" ? "lanes" : "graph"} layout`}
          on={props.outlines}
          onChange={props.onOutlines}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {KIND_ORDER.map((kind) => {
          const all = map.items.filter((i) => i.kind === kind)
          let rows: React.ReactNode[] = []
          if (kind === "workflow" || kind === "node") {
            const roots = [...map.folders.values()].filter(
              (f) => !f.parent && f.members.some((m) => map.byKey.get(m)?.kind === kind),
            )
            rows = roots.flatMap((r) => folderRows(r.path, 0, kind))
          } else {
            const sorted =
              kind === "provider"
                ? [...all].sort(
                    (a, b) => (b as ProviderItem).nodes.length - (a as ProviderItem).nodes.length,
                  )
                : all
            rows = sorted
              .filter((m) => !searching || matchesQuery(m, query))
              .map((m) => row(m.key, 0, itemContent(m), itemMeta(m)))
          }
          return (
            <section key={kind} className="mt-2.5">
              <div className="flex items-center gap-2 px-1.5 py-1 text-[12px] font-semibold">
                <KindGlyph kind={kind} color="var(--muted-foreground)" method={null} />
                <span>{KIND_LABELS[kind]}</span>
                <span className="font-mono text-[11px] font-normal text-muted-foreground">
                  {all.length}
                </span>
                <span className="flex-1" />
                <Switch
                  label={`Show ${KIND_LABELS[kind].toLowerCase()}`}
                  on={props.kinds.has(kind)}
                  onChange={() => props.onToggleKind(kind)}
                />
              </div>
              {rows}
              {!all.length && (
                <p className="px-6 py-1 text-[12px] text-muted-foreground">None yet</p>
              )}
            </section>
          )
        })}
      </div>
      <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2.5 text-[12px] text-muted-foreground">
        <Legend
          line={<line x1={0} y1={4} x2={28} y2={4} stroke="var(--input)" strokeWidth={1.6} />}
        >
          workflow runs node
        </Legend>
        <Legend
          line={
            <line
              x1={1}
              y1={4}
              x2={27}
              y2={4}
              stroke="var(--muted-foreground)"
              strokeWidth={1.8}
              strokeDasharray="1.5 4"
              strokeLinecap="round"
            />
          }
        >
          provider injected
        </Legend>
        <Legend
          line={
            <>
              <path d="M4 4 7 1 10 4 7 7Z" fill="var(--warning)" />
              <path d="M13 4 16 1 19 4 16 7Z" fill="var(--warning)" />
            </>
          }
        >
          middleware a route runs through
        </Legend>
      </div>
    </aside>
  )
}

function Legend({ line, children }: { line: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <svg width={28} height={8} aria-hidden="true" className="shrink-0 overflow-visible">
        {line}
      </svg>
      {children}
    </div>
  )
}

function Switch({
  label,
  on,
  onChange,
}: {
  label: string
  on: boolean
  onChange(on: boolean): void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-4 w-7 shrink-0 rounded-full transition-colors",
        on ? "bg-primary" : "bg-input",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-3 w-3 rounded-full transition-transform",
          on ? "translate-x-3 bg-primary-foreground" : "bg-foreground",
        )}
      />
    </button>
  )
}

function Toggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string
  hint: string
  on: boolean
  onChange(on: boolean): void
}) {
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      <div className="flex-1 leading-tight">
        {label}
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      </div>
      <Switch label={label} on={on} onChange={onChange} />
    </div>
  )
}
