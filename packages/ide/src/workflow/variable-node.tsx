import { Handle, Position } from "@xyflow/react"
import { Check, Maximize2, Minimize2, XCircle } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { JsonSchema, NodeInstance } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useSelectionStore } from "@/store/selection"
import type { Diagnostic } from "./diagnose"
import { JsonCodeEditor } from "./json-code-editor"
import {
  checkValue,
  declaredType,
  scaffoldValue,
  typedByInput,
  typeLabel,
  unwrapSchema,
  VARIABLE_PORT,
  VARIABLE_TYPES,
  type VariableTarget,
  type VariableType,
  variableKind,
} from "./variables"
import { GitChangeMark } from "./workflow-node"

export interface VariableNodeData {
  id: string
  instance: NodeInstance
  /** The type of the input it feeds; undefined when it feeds none. */
  schema?: JsonSchema | undefined
  targets: VariableTarget[]
  onValueChange?: (value: unknown) => void
  /** Picks the variable's type, with its value carried over (one edit). */
  onTypeChange?: (type: VariableType) => void
  issues?: Diagnostic[]
  nodeStatus?: "running" | "completed" | "errored" | "paused"
  gitChange?: "added" | "changed" | undefined
}

const TINT = "var(--info)"
const FIELD =
  "nodrag nopan h-[30px] w-full rounded-[7px] border border-input bg-background px-2.5 text-[12.5px] text-foreground outline-none focus:border-primary"

/** Hints for string formats zod puts in the schema, e.g. `z.string().email()`. */
const FORMAT_PLACEHOLDER: Record<string, string> = {
  email: "name@example.com",
  uri: "https://example.com",
  url: "https://example.com",
  uuid: "00000000-0000-0000-0000-000000000000",
  "date-time": "2026-01-01T00:00:00Z",
  date: "2026-01-01",
}

/**
 * A variable on the canvas: its name and type in the header, an editor that
 * fits the type (a select for enums, a switch, a number or text field, or
 * JSON for objects and lists), and one output handle other inputs read.
 */
export function VariableNode({ data }: { data: Record<string, unknown> }) {
  const {
    id,
    instance,
    schema,
    targets,
    onValueChange,
    onTypeChange,
    issues,
    nodeStatus,
    gitChange,
  } = data as unknown as VariableNodeData
  const isSelected = useSelectionStore(
    (s) => s.selectedNodeId === id || s.selectedNodeIds.includes(id),
  )
  const value = instance.values?.[VARIABLE_PORT]
  const declared = declaredType(instance.values)
  const kind = variableKind(schema, value, declared)
  const label = typeLabel(schema, value, declared)
  const [expanded, setExpanded] = useState(false)
  const errorCount = issues?.filter((i) => i.severity === "error").length ?? 0
  const commit = (next: unknown) => onValueChange?.(next)
  const wide = kind === "json"

  return (
    <div
      data-testid="variable-node"
      className={cn(
        "rounded-[10px] border border-input bg-popover text-[12px] text-card-foreground shadow-[0_10px_24px_rgba(0,0,0,.18)]",
        errorCount > 0 && "border-destructive/70",
        isSelected && "ring-2 ring-primary",
        nodeStatus === "running" && "lorien-running",
        nodeStatus === "completed" && "lorien-completed",
        nodeStatus === "errored" && "lorien-errored",
      )}
      style={{ width: wide ? (expanded ? 440 : 300) : 206, position: "relative" }}
    >
      <div
        data-testid="node-header"
        className="node-drag-handle relative flex h-8 items-center gap-[7px] rounded-t-[10px] border-b border-border px-3"
        style={{ background: `color-mix(in srgb, ${TINT} 10%, var(--popover))` }}
      >
        <span
          className="shrink-0 rounded px-[5px] py-[2px] font-semibold text-[9.5px] tracking-[0.06em]"
          style={{ color: TINT, background: `color-mix(in srgb, ${TINT} 15%, transparent)` }}
        >
          VAR
        </span>
        <span className="min-w-0 flex-1 truncate font-mono font-semibold text-[12.5px]">
          {instance.label ?? id}
        </span>
        {gitChange && <GitChangeMark change={gitChange} />}
        {onTypeChange && !typedByInput(schema) ? (
          <select
            aria-label={`${id} type`}
            title="Type"
            value={kind === "enum" ? "json" : kind}
            onChange={(e) => onTypeChange(e.target.value as VariableType)}
            className="nodrag nopan h-5 shrink-0 cursor-pointer rounded-[5px] border border-input bg-background px-1 text-[10.5px] text-muted-foreground outline-none hover:text-foreground focus:border-primary"
          >
            {VARIABLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        ) : (
          <span
            className="shrink-0 text-[10.5px] text-muted-foreground"
            title={typedByInput(schema) ? "Typed by the input it feeds" : undefined}
          >
            {label}
          </span>
        )}
        <Handle
          type="source"
          position={Position.Right}
          id={VARIABLE_PORT}
          style={{
            top: "50%",
            transform: "translateY(-50%)",
            width: 10,
            height: 10,
            background: TINT,
            border: "2px solid var(--popover)",
          }}
        />
      </div>

      <div className="px-3 py-2.5">
        {kind === "enum" && (
          <EnumEditor id={id} schema={schema as JsonSchema} value={value} commit={commit} />
        )}
        {kind === "boolean" && <BooleanEditor id={id} value={value} commit={commit} />}
        {kind === "number" && (
          <NumberEditor id={id} schema={schema} value={value} commit={commit} />
        )}
        {kind === "string" && (
          <StringEditor id={id} schema={schema} value={value} commit={commit} />
        )}
        {kind === "json" && (
          <JsonEditor
            id={id}
            schema={schema}
            value={value}
            commit={commit}
            expanded={expanded}
            onToggleExpand={() => setExpanded((v) => !v)}
          />
        )}
      </div>

      <div
        data-testid="variable-footer"
        className="truncate border-t border-border px-3 py-1.5 text-[10.5px] text-muted-foreground"
      >
        {targets.length === 0 ? (
          "Not connected to an input yet"
        ) : (
          <>
            Feeds{" "}
            <span className="font-mono text-foreground/85">
              {targets[0]!.portId === ""
                ? targets[0]!.nodeId
                : `${targets[0]!.nodeId}.${targets[0]!.portId}`}
            </span>
            {targets.length > 1 && ` and ${targets.length - 1} more`}
          </>
        )}
      </div>
    </div>
  )
}

interface EditorProps {
  id: string
  value: unknown
  commit: (next: unknown) => void
}

function EnumEditor({ id, schema, value, commit }: EditorProps & { schema: JsonSchema }) {
  const options = (unwrapSchema(schema)?.enum ?? []) as unknown[]
  const index = options.indexOf(value)
  return (
    <select
      aria-label={id}
      className={cn(FIELD, "cursor-pointer")}
      value={index < 0 ? "" : String(index)}
      onChange={(e) => commit(options[Number(e.target.value)])}
    >
      {index < 0 && (
        <option value="" disabled>
          {value === undefined ? "Pick one" : `${JSON.stringify(value)} (not an option)`}
        </option>
      )}
      {options.map((o, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: enum options are positional and may repeat as strings
        <option key={i} value={String(i)}>
          {typeof o === "string" ? o : JSON.stringify(o)}
        </option>
      ))}
    </select>
  )
}

function BooleanEditor({ id, value, commit }: EditorProps) {
  const on = value === true
  return (
    <div className="flex h-[30px] items-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={id}
        onClick={() => commit(!on)}
        className={cn(
          "nodrag nopan relative h-5 w-[34px] shrink-0 rounded-full transition-colors",
          on ? "bg-info" : "bg-input",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] h-3.5 w-3.5 rounded-full bg-popover transition-all",
            on ? "right-[3px]" : "left-[3px]",
          )}
        />
      </button>
      <span className="font-mono text-[12px]">{on ? "true" : "false"}</span>
    </div>
  )
}

/** Keeps a text draft in step with the committed value (undo, other edits). */
function useDraft(shown: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(shown)
  const lastShown = useRef(shown)
  useEffect(() => {
    if (shown !== lastShown.current) {
      lastShown.current = shown
      setDraft(shown)
    }
  }, [shown])
  return [draft, setDraft]
}

function NumberEditor({
  id,
  schema,
  value,
  commit,
}: EditorProps & { schema?: JsonSchema | undefined }) {
  const s = unwrapSchema(schema)
  const [draft, setDraft] = useDraft(typeof value === "number" ? String(value) : "")
  const min = typeof s?.minimum === "number" ? s.minimum : undefined
  const max = typeof s?.maximum === "number" ? s.maximum : undefined
  const range =
    min !== undefined && max !== undefined
      ? `${min}–${max}`
      : min !== undefined
        ? `≥ ${min}`
        : max !== undefined
          ? `≤ ${max}`
          : null
  const problem = typeof value === "number" ? checkValue(schema, value) : null
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          aria-label={id}
          className={cn(FIELD, "font-mono", problem && "border-destructive")}
          value={draft}
          min={min}
          max={max}
          step={s?.type === "integer" ? 1 : "any"}
          onChange={(e) => {
            setDraft(e.target.value)
            const n = Number(e.target.value)
            if (e.target.value.trim() !== "" && !Number.isNaN(n)) commit(n)
          }}
        />
        {range && (
          <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
            {range}
          </span>
        )}
      </div>
      {problem && <span className="text-[11px] text-destructive">{capitalize(problem)}</span>}
    </div>
  )
}

function StringEditor({
  id,
  schema,
  value,
  commit,
}: EditorProps & { schema?: JsonSchema | undefined }) {
  const s = unwrapSchema(schema)
  const format = typeof s?.format === "string" ? s.format : undefined
  return (
    <input
      type="text"
      aria-label={id}
      className={FIELD}
      placeholder={(format && FORMAT_PLACEHOLDER[format]) ?? ""}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => commit(e.target.value)}
    />
  )
}

function JsonEditor({
  id,
  schema,
  value,
  commit,
  expanded,
  onToggleExpand,
}: EditorProps & {
  schema?: JsonSchema | undefined
  expanded: boolean
  onToggleExpand: () => void
}) {
  const shown = value === undefined ? "" : JSON.stringify(value, null, 2)
  const [draft, setDraft] = useDraft(shown)
  let parseError: string | null = null
  let parsed: unknown
  try {
    parsed = draft.trim() === "" ? undefined : JSON.parse(draft)
  } catch (e) {
    parseError = (e as Error).message
  }
  // A schema of `{}` (z.unknown()) accepts anything, so there's nothing to match.
  const shaped = schema !== undefined && Object.keys(unwrapSchema(schema) ?? {}).length > 0
  const problem = parseError || !shaped ? null : checkValue(schema, parsed)
  const lines = draft.split("\n").length
  return (
    <div className="flex flex-col gap-2">
      <JsonCodeEditor
        label={id}
        value={draft}
        invalid={!!(parseError || problem)}
        rows={Math.min(Math.max(lines, 3), expanded ? 30 : 12)}
        onChange={(text) => {
          setDraft(text)
          try {
            commit(JSON.parse(text))
          } catch {
            // Keep the draft; the file keeps the last value that parsed.
          }
        }}
      />
      <div className="flex items-center gap-2 text-[11.5px]">
        {parseError ? (
          <span className="flex min-w-0 items-center gap-1 text-destructive" title={parseError}>
            <XCircle className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">Not valid JSON</span>
          </span>
        ) : problem ? (
          <span className="flex min-w-0 items-center gap-1 text-destructive" title={problem}>
            <XCircle className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{capitalize(problem)}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-success">
            <Check className="h-3 w-3" aria-hidden />
            {shaped ? "Matches schema" : "Valid JSON"}
          </span>
        )}
        <span className="flex-1" />
        {!parseError && parsed !== undefined && draft !== JSON.stringify(parsed, null, 2) && (
          <button
            type="button"
            className="nodrag shrink-0 text-primary hover:underline"
            onClick={() => setDraft(JSON.stringify(parsed, null, 2))}
          >
            Format
          </button>
        )}
        {shaped && (
          <button
            type="button"
            className="nodrag shrink-0 text-primary hover:underline"
            onClick={() => {
              const fresh = scaffoldValue(schema)
              setDraft(JSON.stringify(fresh, null, 2))
              commit(fresh)
            }}
          >
            Reset to schema
          </button>
        )}
        <button
          type="button"
          aria-label={expanded ? "Shrink editor" : "Expand editor"}
          title={expanded ? "Shrink" : "Expand"}
          onClick={onToggleExpand}
          className="nodrag flex h-6 shrink-0 items-center rounded-[5px] border border-input px-1.5 text-muted-foreground hover:text-foreground"
        >
          {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
        </button>
      </div>
    </div>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
