import { Crosshair, ExternalLink, X } from "lucide-react"
import { openWorkspaceFile } from "@/lib/open-file"
import { cn } from "@/lib/utils"
import { methodTone } from "@/panels/run-tab/method-tone"
import { LIFETIME_HELP } from "@/store/providers"
import { KindGlyph } from "./glyphs"
import { shapeColor } from "./map-canvas"
import { KIND_LABELS } from "./map-sidebar"
import type {
  AppMap,
  MapItem,
  MapKind,
  MiddlewareItem,
  NodeItem,
  ProviderItem,
  WorkflowItem,
} from "./model"

export interface MapInspectorProps {
  map: AppMap
  /** An item key, a folder key ("folder:nodes/pets"), or null for the overview. */
  selected: string | null
  focused: boolean
  onSelect(key: string | null): void
  onToggleFocus(key: string): void
  onHover(key: string | null): void
}

const glyphColor = (it: MapItem) => shapeColor({ item: it, kind: it.kind } as never)

/** Details for what's selected on the map, or an overview of the app. Read-only. */
export function MapInspector(props: MapInspectorProps) {
  const { map, selected } = props
  const folder = selected?.startsWith("folder:") ? map.folders.get(selected.slice(7)) : undefined
  const item = selected && !folder ? map.byKey.get(selected) : undefined

  const ref = (key: string, extra?: React.ReactNode) => {
    const it = map.byKey.get(key)
    if (!it) return null
    return (
      <li key={key}>
        <button
          type="button"
          onClick={() => props.onSelect(key)}
          onPointerEnter={() => props.onHover(key)}
          onPointerLeave={() => props.onHover(null)}
          className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12.5px] hover:bg-accent"
        >
          <KindGlyph
            kind={it.kind}
            color={glyphColor(it)}
            method={it.kind === "workflow" ? it.method : null}
          />
          <ItemName item={it} />
          {extra && (
            <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
              {extra}
            </span>
          )}
        </button>
      </li>
    )
  }

  let body: React.ReactNode
  let title: React.ReactNode
  let subtitle: React.ReactNode = null
  let path: string | null = null

  if (folder) {
    title = <span className="font-mono">{folder.path}/</span>
    subtitle = "Folder"
    const byKind = new Map<MapKind, string[]>()
    for (const k of folder.members) {
      const it = map.byKey.get(k)
      if (!it) continue
      byKind.set(it.kind, [...(byKind.get(it.kind) ?? []), k])
    }
    body = [...byKind.entries()].map(([kind, keys]) => (
      <Section key={kind} title={`${KIND_LABELS[kind]} (${keys.length})`}>
        <ul>{keys.map((k) => ref(k))}</ul>
      </Section>
    ))
  } else if (item?.kind === "workflow") {
    title = <ItemName item={item} />
    subtitle = "Workflow"
    path = item.path
    const providers = new Set<string>()
    for (const n of item.nodes)
      for (const p of (map.byKey.get(n) as NodeItem).providers) providers.add(p)
    for (const m of item.middleware)
      for (const p of (map.byKey.get(m) as MiddlewareItem).providers) providers.add(p)
    body = (
      <>
        <Facts
          rows={[
            [
              "Folder",
              <span key="f" className="font-mono">
                {item.folder}/
              </span>,
            ],
            ["Responses", item.responses || "none"],
          ]}
        />
        <Section title="Runs through middleware">
          {item.middleware.length ? (
            <ol>
              {item.middleware.map((m) =>
                ref(m, `#${(map.byKey.get(m) as MiddlewareItem).order + 1}`),
              )}
            </ol>
          ) : (
            <Empty>No middleware guards this route.</Empty>
          )}
        </Section>
        <Section title={`Steps (${item.steps.length})`}>
          {item.steps.length ? (
            <ol>{item.steps.map((s) => ref(s.node, s.id))}</ol>
          ) : (
            <Empty>No node steps.</Empty>
          )}
        </Section>
        <Section title="Providers it reaches">
          {providers.size ? <ul>{[...providers].map((p) => ref(p))}</ul> : <Empty>None.</Empty>}
        </Section>
      </>
    )
  } else if (item?.kind === "node") {
    title = item.label
    subtitle = "Node"
    path = item.path
    body = (
      <>
        {item.description && (
          <p className="text-[12.5px] text-muted-foreground">{item.description}</p>
        )}
        <Section title="Reads providers">
          {item.providers.length ? (
            <ul>{item.providers.map((p) => ref(p))}</ul>
          ) : (
            <Empty>None.</Empty>
          )}
        </Section>
        <Section title={`Used in (${item.usedBy.length})`}>
          {item.usedBy.length ? (
            <ul>{item.usedBy.map((u) => ref(u.workflow, u.step))}</ul>
          ) : (
            <Empty>No workflow runs this node yet.</Empty>
          )}
        </Section>
      </>
    )
  } else if (item?.kind === "provider") {
    title = <span className="font-mono">{item.label}</span>
    subtitle = "Provider"
    path = item.path
    const { info } = item
    body = (
      <>
        {info.description && (
          <p className="text-[12.5px] text-muted-foreground">{info.description}</p>
        )}
        <Facts
          rows={[
            [
              "Lifetime",
              <span key="l" title={LIFETIME_HELP[info.lifetime]}>
                {info.lifetime}
              </span>,
            ],
            ...(info.env.length
              ? [
                  [
                    "Env",
                    <span key="e" className="font-mono">
                      {info.env.map((e) => e.key).join(", ")}
                    </span>,
                  ] as [string, React.ReactNode],
                ]
              : []),
          ]}
        />
        <Section title={`Injected into (${item.nodes.length + item.middleware.length})`}>
          {item.nodes.length + item.middleware.length ? (
            <ul>{[...item.middleware, ...item.nodes].map((k) => ref(k))}</ul>
          ) : (
            <Empty>Nothing reads it yet.</Empty>
          )}
        </Section>
      </>
    )
  } else if (item?.kind === "middleware") {
    title = item.label
    subtitle = "Middleware"
    path = item.path
    body = (
      <>
        <Facts
          rows={[
            [
              "Applies to",
              <span key="a" className="font-mono">
                {item.folder}/**
              </span>,
            ],
            ["Order", `${item.order + 1} in its file`],
          ]}
        />
        <Section title="Reads providers">
          {item.providers.length ? (
            <ul>{item.providers.map((p) => ref(p))}</ul>
          ) : (
            <Empty>None.</Empty>
          )}
        </Section>
        <Section title={`Routes it guards (${item.covers.length})`}>
          {item.covers.length ? (
            <ul>{item.covers.map((w) => ref(w))}</ul>
          ) : (
            <Empty>No routes in that folder yet.</Empty>
          )}
        </Section>
      </>
    )
  } else {
    title = "Overview"
    const count = (k: MapKind) => map.items.filter((i) => i.kind === k).length
    const workflows = map.items.filter((i): i is WorkflowItem => i.kind === "workflow")
    const providers = map.items
      .filter((i): i is ProviderItem => i.kind === "provider")
      .sort((a, b) => b.nodes.length - a.nodes.length)
    const most = Math.max(1, ...providers.map((p) => p.nodes.length))
    const unused = map.items.filter((i): i is NodeItem => i.kind === "node" && !i.usedBy.length)
    body = (
      <>
        <div className="grid grid-cols-2 gap-1.5">
          {(["workflow", "node", "middleware", "provider"] as const).map((k) => (
            <div key={k} className="rounded-md border border-border px-2.5 py-1.5">
              <div className="font-mono text-[17px] font-semibold">{count(k)}</div>
              <div className="text-[11.5px] text-muted-foreground">{KIND_LABELS[k]}</div>
            </div>
          ))}
        </div>
        <Section title="Routes">
          {workflows.length ? (
            <ul>{workflows.map((w) => ref(w.key))}</ul>
          ) : (
            <Empty>No workflows yet.</Empty>
          )}
        </Section>
        {providers.length > 0 && (
          <Section title="Provider use">
            <ul className="flex flex-col gap-1">
              {providers.map((p) => (
                <li key={p.key}>
                  <button
                    type="button"
                    onClick={() => props.onSelect(p.key)}
                    onPointerEnter={() => props.onHover(p.key)}
                    onPointerLeave={() => props.onHover(null)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-[12px] hover:bg-accent"
                  >
                    <span className="w-20 truncate font-mono">{p.label}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${(p.nodes.length / most) * 100}%`,
                          background: glyphColor(p),
                        }}
                      />
                    </span>
                    <span className="w-6 text-right font-mono text-[11px] text-muted-foreground">
                      {p.nodes.length}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {unused.length > 0 && (
          <Section title={`Unused nodes (${unused.length})`}>
            <ul>{unused.map((n) => ref(n.key))}</ul>
          </Section>
        )}
      </>
    )
  }

  return (
    <aside
      aria-label="Map details"
      className="flex h-full min-h-0 flex-col border-l border-border bg-card"
    >
      <div className="flex items-start gap-2 border-b border-border p-3">
        <div className="min-w-0 flex-1">
          {subtitle && (
            <div className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {subtitle}
            </div>
          )}
          <h2 className="truncate text-[14px] font-semibold">{title}</h2>
          {path && (
            <div className="truncate font-mono text-[11px] text-muted-foreground">{path}</div>
          )}
        </div>
        {selected && (
          <button
            type="button"
            aria-label="Clear selection"
            title="Clear selection"
            onClick={() => props.onSelect(null)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {selected && (
        <div className="flex gap-1.5 border-b border-border px-3 py-2">
          <button
            type="button"
            aria-pressed={props.focused}
            onClick={() => props.onToggleFocus(selected)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-[12px] hover:bg-accent",
              props.focused && "border-primary text-primary",
            )}
          >
            <Crosshair className="h-3.5 w-3.5" />
            {props.focused ? "Stop focusing" : "Focus the map on this"}
          </button>
          {path && (
            <button
              type="button"
              onClick={() => path && openWorkspaceFile(path)}
              className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-[12px] hover:bg-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open file
            </button>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">{body}</div>
      <div className="border-t border-border px-3 py-2 text-[11.5px] text-muted-foreground">
        Read-only. Open a file to change it.
      </div>
    </aside>
  )
}

function ItemName({ item }: { item: MapItem }) {
  if (item.kind !== "workflow") return <span className="min-w-0 truncate">{item.label}</span>
  return (
    <span className="min-w-0 truncate">
      {item.method && (
        <span className={cn("mr-1.5 font-mono text-[11px] font-semibold", methodTone(item.method))}>
          {item.method}
        </span>
      )}
      <span className="font-mono">{item.route}</span>
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 truncate">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-1.5 text-[12px] text-muted-foreground">{children}</p>
}
