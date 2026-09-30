import type { Assertion } from "@darrylondil/lorien-runtime/requests"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Fragment, useMemo, useState } from "react"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import type { JsonSchema } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  type CheckShapes,
  childrenOf,
  formatPath,
  type Segment,
  splitPath,
  typeName,
} from "./check-paths"

/** What a check reads, as chosen in the picker. */
export interface Subject {
  target: Assertion["target"]
  path?: string | undefined
  node?: string | undefined
}

const TARGET_LABEL: Record<Assertion["target"], string> = {
  status: "Status",
  duration: "Time",
  header: "Header",
  body: "Body",
  node: "Node",
}

/**
 * What a check reads, shown as `Body › pet › id`. Array indexes are small
 * number fields right in the path; everything else is picked from the shape
 * of the response or node by clicking the path.
 */
export function CheckSubject({
  value,
  shapes,
  hint,
  onChange,
}: {
  value: Subject
  shapes: CheckShapes
  /** The type of what it reads, shown muted at the end. */
  hint?: string | undefined
  onChange: (next: Subject) => void
}) {
  const [open, setOpen] = useState(false)
  const segments = splitPath(value.path)
  const pick = (next: Subject) => {
    onChange(next)
    setOpen(false)
  }

  // Runs of field names between indexes; each run opens the picker.
  const parts: Array<
    { kind: "names"; names: string[]; at: number } | { kind: "index"; at: number }
  > = []
  if (segments) {
    segments.forEach((s, i) => {
      if (typeof s === "number") parts.push({ kind: "index", at: i })
      else {
        const last = parts[parts.length - 1]
        if (last?.kind === "names") last.names.push(s)
        else parts.push({ kind: "names", names: [s], at: i })
      }
    })
  }
  const setIndex = (at: number, n: number) => {
    if (!segments) return
    const next = segments.slice()
    next[at] = n
    onChange({ ...value, path: formatPath(next) })
  }

  const trigger = (children: React.ReactNode, key?: string, label?: string) => (
    <button
      key={key}
      type="button"
      aria-label={label}
      onClick={() => setOpen(true)}
      className="flex min-w-0 items-center gap-1 truncate rounded px-0.5 hover:bg-accent"
    >
      {children}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          data-testid="check-subject"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-0.5 gap-y-1 font-mono text-[11.5px]"
        >
          {trigger(
            <>
              <span className="rounded bg-muted px-1.5 py-px font-sans text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                {TARGET_LABEL[value.target]}
              </span>
              {value.target === "node" && (
                <span className="font-semibold text-foreground">{value.node || "pick a node"}</span>
              )}
              {value.target === "header" && (
                <span className={value.path ? "" : "text-muted-foreground"}>
                  {value.path || "pick a header"}
                </span>
              )}
            </>,
            "target",
            `Change what this check reads: ${describeSubject(value)}`,
          )}
          {value.target !== "header" &&
            segments === null &&
            trigger(<span className="text-destructive">{value.path}</span>, "raw")}
          {value.target !== "header" &&
            parts.map((p) =>
              p.kind === "index" ? (
                <IndexField
                  key={`i${p.at}`}
                  value={segments![p.at] as number}
                  label={`Index into ${formatPath(segments!.slice(0, p.at)) || "the body"}`}
                  onChange={(n) => setIndex(p.at, n)}
                />
              ) : (
                <Fragment key={`n${p.at}`}>
                  {trigger(
                    p.names.map((n, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: path segments are positional
                      <Fragment key={i}>
                        <ChevronRight
                          aria-hidden
                          className="size-3 shrink-0 text-muted-foreground"
                        />
                        <span className="text-foreground">{n}</span>
                      </Fragment>
                    )),
                  )}
                </Fragment>
              ),
            )}
          {value.target === "body" &&
            segments?.length === 0 &&
            trigger(<span className="font-sans text-muted-foreground">whole body</span>, "whole")}
          <span className="ml-auto" />
          {hint && <span className="font-sans text-[10.5px] text-muted-foreground">{hint}</span>}
          <button
            type="button"
            aria-label="Pick a field"
            onClick={() => setOpen(true)}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[min(340px,90vw)] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SubjectPicker value={value} shapes={shapes} onPick={pick} />
      </PopoverContent>
    </Popover>
  )
}

function IndexField({
  value,
  label,
  onChange,
}: {
  value: number
  label: string
  onChange: (n: number) => void
}) {
  const [text, setText] = useState(String(value))
  const shown = Number(text) === value ? text : String(value)
  return (
    <span className="flex items-center text-muted-foreground">
      [
      <input
        aria-label={label}
        inputMode="numeric"
        value={shown}
        onChange={(e) => {
          const t = e.target.value.replace(/\D/g, "")
          setText(t)
          if (t !== "") onChange(Number(t))
        }}
        onBlur={() => setText(String(value))}
        style={{ width: `${Math.max(1, shown.length) + 1.2}ch` }}
        className="rounded border border-input bg-background px-0.5 text-center text-foreground focus:border-primary focus:outline-none"
      />
      ]
    </span>
  )
}

/** "body pet[0].id", "node AddPet output.id": for labels and the AI. */
export function describeSubject(s: Subject): string {
  switch (s.target) {
    case "status":
      return "status"
    case "duration":
      return "response time"
    case "header":
      return `header ${s.path ?? ""}`.trim()
    case "body":
      return s.path ? `body ${s.path}` : "whole body"
    case "node":
      return `node ${s.node ?? ""}${s.path ? ` ${s.path}` : ""}`
  }
}

interface Row {
  key: string
  label: string
  /** Shown muted after the label: its type, or "ran" for a node. */
  hint?: string | undefined
  /** Picking the row sets this subject; rows without one only expand. */
  subject?: Subject
  children?: () => Row[]
  /** Array item rows read as `[0]`. */
  index?: boolean
}

function schemaRows(
  schema: JsonSchema | undefined,
  prefix: Segment[],
  make: (segments: Segment[]) => Subject,
  depth = 0,
): Row[] {
  if (depth > 8) return []
  return childrenOf(schema).map(({ key, schema: sub }) => {
    const segments = [...prefix, key]
    const kids = childrenOf(sub)
    return {
      key: formatPath(segments),
      label: typeof key === "number" ? "[0]" : key,
      hint: typeof key === "number" ? "each item" : typeName(sub),
      index: typeof key === "number",
      subject: make(segments),
      ...(kids.length > 0 ? { children: () => schemaRows(sub, segments, make, depth + 1) } : {}),
    }
  })
}

function sameSubject(a: Subject | undefined, b: Subject): boolean {
  return (
    !!a &&
    a.target === b.target &&
    (a.path ?? "") === (b.path ?? "") &&
    (a.node ?? "") === (b.node ?? "")
  )
}

/** The picker's rows: status, time, headers, the body's fields, and each node. */
function rootRows(shapes: CheckShapes): Row[] {
  const headers = [...new Set(["content-type", ...shapes.headers.map((h) => h.toLowerCase())])]
  return [
    { key: "status", label: "Status code", hint: "number", subject: { target: "status" } },
    { key: "duration", label: "Response time", hint: "ms", subject: { target: "duration" } },
    {
      key: "headers",
      label: "Headers",
      children: () =>
        headers.map((h) => ({
          key: `header:${h}`,
          label: h,
          hint: "string",
          subject: { target: "header", path: h },
        })),
    },
    {
      key: "body",
      label: "Body",
      hint: typeName(shapes.body) || undefined,
      subject: { target: "body", path: "" },
      children: () =>
        schemaRows(shapes.body, [], (segments) => ({ target: "body", path: formatPath(segments) })),
    },
    ...(shapes.nodes.length > 0
      ? [
          {
            key: "nodes",
            label: "Nodes",
            children: () =>
              shapes.nodes.map((n) => ({
                key: `node:${n.id}`,
                label: n.id,
                hint: "ran",
                subject: { target: "node" as const, node: n.id, path: "" },
                children: () =>
                  (["input", "output"] as const)
                    .map(
                      (side): Row => ({
                        key: `node:${n.id}:${side}`,
                        label: side,
                        hint: typeName(n[side]) || undefined,
                        subject: { target: "node", node: n.id, path: side },
                        children: () =>
                          schemaRows(n[side], [side], (segments) => ({
                            target: "node",
                            node: n.id,
                            path: formatPath(segments),
                          })),
                      }),
                    )
                    .concat({
                      key: `node:${n.id}:error`,
                      label: "error",
                      hint: "string",
                      subject: { target: "node", node: n.id, path: "error" },
                    }),
              })),
          },
        ]
      : []),
  ]
}

/** Keys of the rows leading to the current subject, opened when the picker opens. */
function openKeysFor(value: Subject): Set<string> {
  const keys = new Set<string>(["body"])
  if (value.target === "header") keys.add("headers")
  if (value.target === "node" && value.node) {
    keys.add("nodes")
    keys.add(`node:${value.node}`)
  }
  const segs = splitPath(value.path) ?? []
  if (value.target === "node" && segs[0] !== undefined) keys.add(`node:${value.node}:${segs[0]}`)
  for (let i = 1; i < segs.length; i++) {
    const prefix = segs.slice(0, i).map((s) => (typeof s === "number" ? 0 : s))
    keys.add(formatPath(prefix))
  }
  return keys
}

function SubjectPicker({
  value,
  shapes,
  onPick,
}: {
  value: Subject
  shapes: CheckShapes
  onPick: (s: Subject) => void
}) {
  const rows = useMemo(() => rootRows(shapes), [shapes])
  const [openKeys, setOpenKeys] = useState(() => openKeysFor(value))
  const typeable = value.target === "body" || value.target === "node" || value.target === "header"
  const [typed, setTyped] = useState(typeable ? (value.path ?? "") : "")
  const toggle = (key: string) =>
    setOpenKeys((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  // The index-free form of the current path, to highlight its row.
  const selected: Subject = {
    ...value,
    ...(value.path !== undefined
      ? {
          path: formatPath(
            (splitPath(value.path) ?? []).map((s) => (typeof s === "number" ? 0 : s)),
          ),
        }
      : {}),
  }

  const render = (list: Row[], depth: number): React.ReactNode =>
    list.map((r) => {
      const isOpen = openKeys.has(r.key)
      const active = r.subject && sameSubject(selected, r.subject)
      return (
        <li key={r.key}>
          <div
            className={cn(
              "flex h-7 items-center gap-1 rounded-md pr-2 text-[12px]",
              active ? "bg-primary/15 text-primary" : "hover:bg-accent",
            )}
            style={{ paddingLeft: 4 + depth * 14 }}
          >
            {r.children ? (
              <button
                type="button"
                aria-label={`${isOpen ? "Collapse" : "Expand"} ${r.label}`}
                aria-expanded={isOpen}
                onClick={() => toggle(r.key)}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={cn("size-3.5 transition-transform", isOpen && "rotate-90")}
                />
              </button>
            ) : (
              <span className="w-[18px] shrink-0" />
            )}
            <button
              type="button"
              disabled={!r.subject}
              onClick={() => (r.subject ? onPick(r.subject) : toggle(r.key))}
              className={cn(
                "flex min-w-0 flex-1 items-baseline gap-2 text-left disabled:cursor-default",
                r.index ? "font-mono text-muted-foreground" : depth > 0 && "font-mono",
              )}
            >
              <span className="min-w-0 truncate">{r.label}</span>
              {r.hint && (
                <span className="ml-auto shrink-0 font-sans text-[10.5px] text-muted-foreground">
                  {r.hint}
                </span>
              )}
            </button>
          </div>
          {r.children && isOpen && <ul>{render(r.children(), depth + 1)}</ul>}
        </li>
      )
    })

  const typedPath = () => {
    const path = typed.trim()
    if (value.target === "node") onPick({ target: "node", node: value.node ?? "", path })
    else if (value.target === "header") onPick({ target: "header", path })
    else onPick({ target: "body", path })
  }

  return (
    <div className="flex flex-col" data-testid="check-picker">
      <div className="border-b border-border px-3 py-2 text-[11.5px] text-muted-foreground">
        Pick what this check reads.
        {shapes.body === undefined && " Send the request once to see its body's fields here."}
      </div>
      <ul className="max-h-[320px] overflow-y-auto p-1">{render(rows, 0)}</ul>
      {typeable && (
        <form
          className="flex items-center gap-1.5 border-t border-border px-2 py-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            typedPath()
          }}
        >
          <input
            aria-label={value.target === "header" ? "Type a header" : "Type a path"}
            placeholder={
              value.target === "node"
                ? "output.user.id"
                : value.target === "header"
                  ? "x-request-id"
                  : "items[2].name"
            }
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[11.5px] focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            className="h-7 shrink-0 rounded-md px-2 text-[11.5px] text-primary hover:bg-accent"
          >
            Use {value.target === "header" ? "header" : "path"}
          </button>
        </form>
      )}
    </div>
  )
}
