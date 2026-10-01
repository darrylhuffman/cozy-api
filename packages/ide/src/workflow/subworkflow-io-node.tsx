import { Handle, Position } from "@xyflow/react"
import { Plus, X } from "lucide-react"
import { useEffect, useState } from "react"
import type { NodeInstance, WorkflowFile } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useSelectionStore } from "@/store/selection"
import type { Diagnostic } from "./diagnose"
import {
  addInputField,
  FIELD_TYPES,
  type FieldType,
  fieldTypeName,
  inputFields,
  invalidPortName,
  removeInputField,
  removeOutput,
  renameInputField,
  renameOutput,
  SUBWORKFLOW_INPUT,
  setInputFieldType,
} from "./subworkflow"
import { GitChangeMark, ROOT_HANDLE_ID } from "./workflow-node"

export interface SubworkflowIoNodeData {
  id: string
  instance: NodeInstance
  /** Applies an edit to the whole workflow (one undo step). */
  onEdit?: (edit: (wf: WorkflowFile) => WorkflowFile | null) => void
  issues?: Diagnostic[]
  nodeStatus?: "running" | "completed" | "errored" | "paused" | "skipped"
  gitChange?: "added" | "changed" | undefined
}

const TINT = "var(--flow)"
const ROW_HEIGHT = 30
const NODE_WIDTH = 250

function handleStyle(connected: boolean): React.CSSProperties {
  return {
    top: "50%",
    transform: "translateY(-50%)",
    width: 10,
    height: 10,
    background: connected ? TINT : "var(--muted-foreground)",
    border: "2px solid var(--popover)",
  }
}

/**
 * A sub-workflow's Input or Output on its own canvas. The Input lists the
 * sub-workflow's inputs: each has a name, a type, and a handle that nodes
 * inside read from. The Output lists its outputs: each is wired from a value
 * inside, and dropping a value on its last row adds one.
 */
export function SubworkflowIoNode({ data }: { data: Record<string, unknown> }) {
  const { id, instance, onEdit, issues, nodeStatus, gitChange } =
    data as unknown as SubworkflowIoNodeData
  const isInput = instance.uses === SUBWORKFLOW_INPUT
  const isSelected = useSelectionStore(
    (s) => s.selectedNodeId === id || s.selectedNodeIds.includes(id),
  )
  const errorCount = issues?.filter((i) => i.severity === "error").length ?? 0
  const edit = (fn: (wf: WorkflowFile) => WorkflowFile | null) => onEdit?.(fn)

  return (
    <div
      data-testid="io-node"
      className={cn(
        "rounded-[10px] border border-input bg-popover text-[12px] text-card-foreground shadow-[0_10px_24px_rgba(0,0,0,.18)]",
        errorCount > 0 && "border-destructive/70",
        isSelected && "ring-2 ring-primary",
        nodeStatus && `lorien-${nodeStatus}`,
      )}
      style={{ width: NODE_WIDTH, position: "relative" }}
    >
      <div
        data-testid="node-header"
        className="node-drag-handle flex h-[34px] items-center gap-[7px] rounded-t-[10px] border-b border-border px-3"
        style={{ background: `color-mix(in srgb, ${TINT} 10%, var(--popover))` }}
      >
        <span
          className="shrink-0 rounded px-[5px] py-[2px] font-semibold text-[9.5px] tracking-[0.06em]"
          style={{ color: TINT, background: `color-mix(in srgb, ${TINT} 15%, transparent)` }}
        >
          {isInput ? "IN" : "OUT"}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold text-[13px]">
          {instance.label ?? (isInput ? "Input" : "Output")}
        </span>
        {gitChange && <GitChangeMark change={gitChange} />}
      </div>
      {isInput ? <InputRows id={id} instance={instance} edit={edit} /> : null}
      {!isInput ? <OutputRows id={id} instance={instance} edit={edit} /> : null}
      <div className="border-t border-border px-3 py-1.5 text-[10.5px] text-muted-foreground">
        {isInput
          ? "The sub-workflow's inputs. Nodes inside read them from here."
          : "The sub-workflow's outputs. Callers read them from its node."}
      </div>
    </div>
  )
}

type Edit = (fn: (wf: WorkflowFile) => WorkflowFile | null) => void

function InputRows({ id, instance, edit }: { id: string; instance: NodeInstance; edit: Edit }) {
  const fields = Object.entries(inputFields(instance))
  return (
    <div className="flex flex-col py-1.5">
      {fields.length === 0 && (
        <div className="px-3 py-1 text-[11.5px] text-muted-foreground">No inputs yet.</div>
      )}
      {fields.map(([name, type]) => {
        const picked = fieldTypeName(type)
        return (
          <div
            key={name}
            className="group/row relative flex items-center gap-1.5 pr-4 pl-2"
            style={{ height: ROW_HEIGHT }}
          >
            <button
              type="button"
              aria-label={`Remove input ${name}`}
              title="Remove this input"
              onClick={() => edit((wf) => removeInputField(wf, id, name))}
              className="nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
            >
              <X aria-hidden className="h-3 w-3" />
            </button>
            <PortName
              name={name}
              label={`Input name ${name}`}
              onRename={(to) => edit((wf) => renameInputField(wf, id, name, to))}
            />
            {picked ? (
              <select
                aria-label={`Type of ${name}`}
                value={picked}
                onChange={(e) =>
                  edit((wf) => setInputFieldType(wf, id, name, e.target.value as FieldType))
                }
                className="nodrag h-6 shrink-0 rounded-[6px] border border-input bg-background px-1 font-mono text-[11px] text-muted-foreground outline-none focus:border-primary"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className="shrink-0 font-mono text-[11px] text-muted-foreground"
                title="Typed by a JSON Schema in the file"
              >
                schema
              </span>
            )}
            <Handle type="source" position={Position.Right} id={name} style={handleStyle(true)} />
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => edit((wf) => addInputField(wf, id).workflow)}
        className="nodrag mx-2 mt-1 flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus aria-hidden className="h-3.5 w-3.5" />
        Add input
      </button>
    </div>
  )
}

function OutputRows({ id, instance, edit }: { id: string; instance: NodeInstance; edit: Edit }) {
  const wired = typeof instance.in === "object" && instance.in ? Object.entries(instance.in) : []
  return (
    <div className="flex flex-col py-1.5">
      {wired.map(([name, ref]) => (
        <div
          key={name}
          className="group/row relative flex items-center gap-1.5 pr-2 pl-3"
          style={{ height: ROW_HEIGHT }}
        >
          <Handle type="target" position={Position.Left} id={name} style={handleStyle(true)} />
          <PortName
            name={name}
            label={`Output name ${name}`}
            onRename={(to) => edit((wf) => renameOutput(wf, id, name, to))}
          />
          <span
            className="min-w-0 flex-1 truncate text-right font-mono text-[10.5px] text-muted-foreground"
            title={ref}
          >
            {ref}
          </span>
          <button
            type="button"
            aria-label={`Remove output ${name}`}
            title="Remove this output"
            onClick={() => edit((wf) => removeOutput(wf, id, name))}
            className="nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
          >
            <X aria-hidden className="h-3 w-3" />
          </button>
        </div>
      ))}
      <div
        data-testid="output-drop"
        className="relative mx-2 mt-1 flex h-8 items-center rounded-md border border-dashed border-border px-2 text-[11px] text-muted-foreground"
      >
        <Handle
          type="target"
          position={Position.Left}
          id={ROOT_HANDLE_ID}
          style={{ ...handleStyle(false), left: -9 }}
        />
        Drop a value here to add an output
      </div>
    </div>
  )
}

/** A port name that edits in place; an invalid or taken name snaps back. */
function PortName({
  name,
  label,
  onRename,
}: {
  name: string
  label: string
  onRename: (to: string) => void
}) {
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  const problem = draft === name ? null : invalidPortName(draft)
  // A rename that lands re-keys the row; one refused (a taken name) snaps back.
  const commit = () => {
    if (draft !== name && !problem) onRename(draft)
    setDraft(name)
  }
  return (
    <input
      aria-label={label}
      value={draft}
      title={problem ?? "Rename"}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value.trim())}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") {
          setDraft(name)
          e.currentTarget.blur()
        }
      }}
      className={cn(
        "nodrag h-6 min-w-0 flex-1 rounded-[6px] border border-transparent bg-transparent px-1.5 font-mono text-[12px] text-foreground outline-none hover:border-input focus:border-primary focus:bg-background",
        problem && "border-destructive focus:border-destructive",
      )}
    />
  )
}
