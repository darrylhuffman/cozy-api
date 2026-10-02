import { ChevronDown, ChevronRight } from "lucide-react"
import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { JsonSchema } from "@/lib/api"
import { cn } from "@/lib/utils"
import { childrenOf, typeName } from "@/panels/run-tab/check-paths"

/** Object fields under a schema (array items are skipped: `field` reads names, not indexes). */
function fieldsOf(schema: JsonSchema | undefined): Array<{ key: string; schema?: JsonSchema }> {
  return childrenOf(schema).flatMap((c) =>
    typeof c.key === "string" ? [{ key: c.key, ...(c.schema ? { schema: c.schema } : {}) }] : [],
  )
}

const keepPointer = {
  onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  onMouseDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
}

/**
 * A logic node's `field`: a path into the value it compares, picked from that
 * value's type like a check's subject in the Tests tab. Shows `profile › plan`;
 * empty compares the whole value.
 */
export function FieldPicker({
  label,
  value,
  schema,
  onCommit,
}: {
  label: string
  /** The dotted path, e.g. "profile.plan"; undefined compares the whole value. */
  value: string | undefined
  /** The type of the value the path reads into. */
  schema: JsonSchema
  onCommit: ((value: string | undefined) => void) | undefined
}) {
  const [open, setOpen] = useState(false)
  const segments = value ? value.split(".") : []
  const pick = (next: string | undefined) => {
    setOpen(false)
    onCommit?.(next)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="field-picker"
          aria-label={`Choose ${label}`}
          disabled={!onCommit}
          {...keepPointer}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "nodrag nopan inline-flex h-5 max-w-[150px] shrink-0 items-center gap-0.5 truncate rounded-[5px] px-[7px] font-mono text-[10.5px]",
            open
              ? "bg-primary/14 text-primary"
              : value
                ? "bg-accent text-foreground hover:bg-input"
                : "border border-dashed border-input text-muted-foreground hover:text-foreground",
          )}
        >
          {segments.length === 0 ? (
            <span className="font-sans">whole value</span>
          ) : (
            segments.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: path segments are positional
              <span key={i} className="flex min-w-0 items-center gap-0.5">
                {i > 0 && <ChevronRight aria-hidden className="h-2.5 w-2.5 shrink-0 opacity-60" />}
                <span className="truncate">{s}</span>
              </span>
            ))
          )}
          <ChevronDown className="ml-0.5 h-2.5 w-2.5 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="nodrag nopan w-[260px] p-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div {...keepPointer} data-testid="field-picker-rows" className="max-h-64 overflow-y-auto">
          <Row
            label="whole value"
            hint={typeName(schema) || undefined}
            depth={0}
            active={!value}
            onPick={() => pick(undefined)}
          />
          <FieldRows schema={schema} prefix={[]} depth={0} current={value} onPick={pick} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function FieldRows({
  schema,
  prefix,
  depth,
  current,
  onPick,
}: {
  schema: JsonSchema | undefined
  prefix: string[]
  depth: number
  current: string | undefined
  onPick: (path: string) => void
}) {
  if (depth > 6) return null
  return (
    <>
      {fieldsOf(schema).map(({ key, schema: sub }) => (
        <FieldRow
          key={key}
          path={[...prefix, key]}
          schema={sub}
          depth={depth}
          current={current}
          onPick={onPick}
        />
      ))}
    </>
  )
}

function FieldRow({
  path,
  schema,
  depth,
  current,
  onPick,
}: {
  path: string[]
  schema: JsonSchema | undefined
  depth: number
  current: string | undefined
  onPick: (path: string) => void
}) {
  const dotted = path.join(".")
  const hasKids = fieldsOf(schema).length > 0
  // Open the rows that lead to the current pick.
  const [open, setOpen] = useState(() => current?.startsWith(`${dotted}.`) ?? false)
  return (
    <>
      <Row
        label={path[path.length - 1] ?? ""}
        hint={typeName(schema) || undefined}
        depth={depth}
        active={current === dotted}
        onPick={() => onPick(dotted)}
        {...(hasKids && { open, onToggle: () => setOpen((o) => !o) })}
      />
      {hasKids && open && (
        <FieldRows
          schema={schema}
          prefix={path}
          depth={depth + 1}
          current={current}
          onPick={onPick}
        />
      )}
    </>
  )
}

function Row({
  label,
  hint,
  depth,
  active,
  open,
  onToggle,
  onPick,
}: {
  label: string
  hint: string | undefined
  depth: number
  active: boolean
  open?: boolean
  onToggle?: () => void
  onPick: () => void
}) {
  return (
    <div
      className={cn(
        "flex h-7 items-center gap-1 rounded-md pr-2 text-[12px]",
        active ? "bg-primary/15 text-primary" : "hover:bg-accent",
      )}
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      {onToggle ? (
        <button
          type="button"
          aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
          aria-expanded={open}
          onClick={onToggle}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
      ) : (
        <span className="w-[18px] shrink-0" />
      )}
      <button
        type="button"
        aria-pressed={active}
        onClick={onPick}
        className={cn(
          "flex min-w-0 flex-1 items-baseline gap-2 text-left",
          depth > 0 || label !== "whole value" ? "font-mono" : "font-sans",
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        {hint && (
          <span className="ml-auto shrink-0 font-sans text-[10.5px] text-muted-foreground">
            {hint}
          </span>
        )}
      </button>
    </div>
  )
}
