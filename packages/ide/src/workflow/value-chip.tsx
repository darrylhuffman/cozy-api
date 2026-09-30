import { ChevronDown } from "lucide-react"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { JsonSchema } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * What an input row shows on its right-hand side:
 *  - connected: fed by another node's output (`in:`)
 *  - set:       a literal the user typed (`values:`)
 *  - default:   nothing set; the schema default applies
 *  - missing:   nothing set, no default, and the field is required
 *  - empty:     nothing set, optional
 */
export type ChipState = "connected" | "set" | "default" | "missing" | "empty"

const CHIP =
  "nodrag nopan inline-flex h-5 max-w-[150px] shrink-0 items-center gap-1 truncate rounded-[5px] px-[7px] font-mono text-[10.5px]"

const STATE_CLASS: Record<ChipState, string> = {
  connected: "bg-primary/14 text-primary",
  set: "bg-accent text-foreground hover:bg-input",
  default: "border border-dashed border-input italic text-muted-foreground hover:text-foreground",
  missing: "border border-dashed border-destructive font-sans text-destructive",
  empty: "border border-dashed border-input text-muted-foreground hover:text-foreground",
}

/**
 * React Flow selects and focuses a node on pointer down, which would blur an
 * editor the moment it opens. Chips keep the pointer to themselves.
 */
const keepPointer = {
  onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  onMouseDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
}

/** Short text for a value on the canvas. */
export function formatValue(value: unknown): string {
  if (value === undefined) return ""
  if (typeof value === "string") return value === "" ? '""' : value
  if (Array.isArray(value)) return `[${value.length}]`
  if (value !== null && typeof value === "object") return "{…}"
  return String(value)
}

export function isEditableSchema(schema: JsonSchema | undefined): schema is JsonSchema {
  return (
    schema !== undefined &&
    (Array.isArray(schema.enum) ||
      schema.type === "string" ||
      schema.type === "number" ||
      schema.type === "integer" ||
      schema.type === "boolean")
  )
}

interface ValueChipProps {
  portId: string
  label: string
  state: ChipState
  /** The literal or default to show (ignored for connected / missing). */
  value: unknown
  /** The upstream reference when connected, e.g. "loadCart.cart". */
  reference?: string | undefined
  schema?: JsonSchema | undefined
  /** The (template-expanded) schema default, offered as "Reset to default". */
  defaultValue?: unknown
  /** Commit a new literal; `undefined` clears it back to the default. */
  onCommit?: ((portId: string, value: unknown) => void) | undefined
}

/**
 * The value on an input row. Connected inputs show their source; editable
 * scalars open in place (text and numbers) or in a small picker (enums);
 * booleans are a switch. A commit is one call to `onCommit`, so one undo step.
 */
export function ValueChip(p: ValueChipProps) {
  if (p.state === "connected") {
    return (
      <span className={cn(CHIP, STATE_CLASS.connected)} title={`From ${p.reference}`}>
        ← {p.reference}
      </span>
    )
  }

  const editable = isEditableSchema(p.schema) && p.onCommit !== undefined
  const shown =
    p.state === "missing" ? "required" : p.state === "empty" ? "—" : formatValue(p.value)

  if (!editable) {
    return (
      <span
        data-testid={`input-chip-${p.portId}`}
        {...keepPointer}
        className={cn(CHIP, STATE_CLASS[p.state])}
      >
        {shown}
      </span>
    )
  }

  const schema = p.schema as JsonSchema
  const commit = p.onCommit as (portId: string, value: unknown) => void

  if (schema.type === "boolean" && !Array.isArray(schema.enum)) {
    const on = p.value === true
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={p.label}
        data-testid={`input-widget-${p.portId}`}
        {...keepPointer}
        onClick={(e) => {
          e.stopPropagation()
          commit(p.portId, !on)
        }}
        className={cn(
          "nodrag nopan relative h-[15px] w-[26px] shrink-0 rounded-full transition-colors",
          on ? "bg-primary" : "bg-input",
          p.state === "default" && "opacity-70",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] h-[11px] w-[11px] rounded-full transition-all",
            on ? "right-[2px] bg-primary-foreground" : "left-[2px] bg-muted-foreground",
          )}
        />
      </button>
    )
  }

  if (Array.isArray(schema.enum)) {
    return (
      <EnumChip {...p} shown={shown} options={schema.enum.map((o) => String(o))} commit={commit} />
    )
  }

  return <TextChip {...p} shown={shown} schema={schema} commit={commit} />
}

function TextChip({
  portId,
  label,
  state,
  value,
  shown,
  schema,
  commit,
}: ValueChipProps & {
  shown: string
  schema: JsonSchema
  commit: (portId: string, value: unknown) => void
}) {
  const [editing, setEditing] = useState(false)
  const numeric = schema.type === "number" || schema.type === "integer"
  const initial = state === "set" && value !== undefined ? String(value) : ""
  const [draft, setDraft] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const finish = () => {
    setEditing(false)
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    if (draft === initial) return
    if (draft === "") {
      commit(portId, undefined)
      return
    }
    if (numeric) {
      const n = schema.type === "integer" ? Number.parseInt(draft, 10) : Number.parseFloat(draft)
      if (!Number.isNaN(n)) commit(portId, n)
      return
    }
    commit(portId, draft)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={numeric ? "number" : "text"}
        aria-label={label}
        data-testid={`input-widget-${portId}`}
        {...keepPointer}
        value={draft}
        // biome-ignore lint/a11y/noAutofocus: the chip was just clicked to edit
        autoFocus
        placeholder={state === "default" ? formatValue(value) : ""}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          e.stopPropagation()
          if (e.key === "Enter") inputRef.current?.blur()
          if (e.key === "Escape") {
            cancelled.current = true
            inputRef.current?.blur()
          }
        }}
        className="nodrag nopan h-5 w-[120px] shrink-0 rounded-[5px] border-[1.5px] border-primary bg-background px-1.5 text-right font-mono text-[10.5px] text-foreground outline-none"
      />
    )
  }

  return (
    <button
      type="button"
      data-testid={`input-chip-${portId}`}
      {...keepPointer}
      aria-label={`Edit ${label}`}
      title={shown}
      onClick={(e) => {
        e.stopPropagation()
        setDraft(initial)
        setEditing(true)
      }}
      className={cn(CHIP, STATE_CLASS[state])}
    >
      <span className="truncate">{shown}</span>
    </button>
  )
}

function EnumChip({
  portId,
  label,
  state,
  value,
  shown,
  options,
  defaultValue,
  commit,
}: ValueChipProps & {
  shown: string
  options: string[]
  commit: (portId: string, value: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const current = value === undefined ? undefined : String(value)
  const pick = (next: string | undefined) => {
    setOpen(false)
    commit(portId, next)
  }
  const segmented = options.length <= 3
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`input-chip-${portId}`}
          {...keepPointer}
          aria-label={`Choose ${label}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(CHIP, "font-sans", open ? STATE_CLASS.connected : STATE_CLASS[state])}
        >
          <span className="truncate">{shown}</span>
          <ChevronDown className="h-2.5 w-2.5 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="nodrag nopan w-[240px] space-y-2 p-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-mono text-foreground">{label}</span>enum
        </div>
        <div
          data-testid={`input-widget-${portId}`}
          {...keepPointer}
          role="listbox"
          aria-label={label}
          className={cn(
            "gap-0.5 rounded-md bg-background p-0.5",
            segmented ? "grid" : "flex max-h-56 flex-col overflow-y-auto",
          )}
          style={
            segmented
              ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }
              : undefined
          }
        >
          {options.map((opt) => {
            const selected = opt === current
            return (
              <button
                key={opt}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => pick(opt)}
                className={cn(
                  "h-[26px] truncate rounded-[5px] px-2 text-[11.5px]",
                  segmented ? "text-center" : "text-left",
                  selected
                    ? "bg-popover font-semibold text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt}
              </button>
            )
          })}
        </div>
        {defaultValue !== undefined && (
          <div className="flex items-center text-[11px] text-muted-foreground">
            <span className="flex-1">Default: {formatValue(defaultValue)}</span>
            {state === "set" && (
              <button
                type="button"
                onClick={() => pick(undefined)}
                className="text-primary hover:underline"
              >
                Reset to default
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
