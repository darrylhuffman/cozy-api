import { Handle, Position, useConnection } from "@xyflow/react"
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  GitBranch,
  Plus,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react"
import { useState } from "react"
import { ProviderChip } from "@/code/provider-card"
import type { JsonSchema, NodeInstance } from "@/lib/api"
import { openCodeFile } from "@/lib/open-code-file"
import { cn } from "@/lib/utils"
import { middlewareFor, useProvidersStore } from "@/store/providers"
import { useSelectionStore } from "@/store/selection"
import { idFromUses } from "./add-node"
import { conditionColor } from "./condition-edge"
import { type Condition, parseCondition, WHEN_HANDLE_ID } from "./conditions"
import { SWITCH_USES, switchCases } from "./core-nodes"
import type { NodePorts, PortNode } from "./derive-ports"
import { type Diagnostic, TRIGGERS } from "./diagnose"
import { resolveAccentColor } from "./tailwind-colors"
import { expandTemplate } from "./template"
import { type ChipState, ValueChip } from "./value-chip"

export interface WorkflowNodeData {
  id: string
  instance: NodeInstance
  ports: NodePorts
  /** Accent color (CSS color string). When set, renders a left stripe. */
  color?: string | null
  /**
   * Display name pulled from the node's schema (`defineNode({ name })` or a
   * `@core/*` built-in). Preferred over the technical id so duplicate drops
   * like `save-user-2` still render as "Save User".
   */
  schemaName?: string | null
  /** Set of EXPANDED parent paths for the inputs tree. Optional — defaults to
   *  the natural "everything collapsed" state.  The editor passes this in to
   *  lift expansion state out of the node and into a single source of truth. */
  expandedInputs?: ReadonlySet<string>
  /** Set of EXPANDED parent paths for the outputs tree. */
  expandedOutputs?: ReadonlySet<string>
  /** Toggle callback. When provided, the node delegates toggle clicks to the
   *  editor; otherwise it falls back to local useState (for unit tests). */
  onTogglePort?: (side: "input" | "output", handleId: string) => void
  /**
   * Called when the user edits a literal value in an inline input widget.
   * The editor writes the new value into the workflow's `values:` block and
   * marks the tab dirty.
   */
  onInputValueChange?: (portId: string, value: unknown) => void
  /**
   * The workflow file path (e.g. "workflows/users/create.workflow"). Used to
   * expand template tokens like `{workflow_path}` in schema defaults so the
   * widget shows a sensible "/users" instead of the raw template.
   */
  workflowPath?: string
  /**
   * Node-level breakpoints. Each side is rendered as a red dot on the
   * corresponding edge of the node header. Both can be true.
   */
  nodeBreakpoint?: { before: boolean; after: boolean }
  /**
   * Set of output port ids that have a port-level breakpoint set. A red dot is
   * rendered overlaid on the matching output port handle.
   */
  portBreakpoints?: Set<string>
  /** Validation problems attached to this node (see diagnose.ts). */
  issues?: Diagnostic[]
  /** Results of this node's test cases, once they have been run. */
  tests?: { total: number; passed: number; failed: number; run: number } | null
  /** Set when the node was added or changed since the last commit. */
  gitChange?: "added" | "changed" | undefined
  /** Removes the node's `when` condition. */
  onClearCondition?: () => void
  /** A switch's cases changed; `removed` is the index of a case taken out. */
  onSwitchCasesChange?: (cases: unknown[], removed?: number) => void
}

// Using the xyflow NodeProps generic requires the data type to extend Node which
// carries position/measured etc. Instead we accept the full props object and
// extract `data` ourselves — this keeps our interface clean.
interface WorkflowNodeProps {
  data: Record<string, unknown>
}

const ROW_HEIGHT = 26
const INDENT_PX = 12
/** When a branch has more than this many children, show a "+N more" button. */
const VISIBLE_COUNT = 6

/**
 * React Flow requires non-empty handle ids for connections to work reliably.
 * The root input port (port.id === "") is rendered with this sentinel id so
 * that drag-to-connect on a collapsed node produces a valid connection event.
 * All edge/onConnect logic translates "$root" ↔ "" at the boundary.
 */
export const ROOT_HANDLE_ID = "$root"

const EMPTY_ROOT_INPUT: PortNode = {
  id: "",
  label: "input",
  children: [],
  isLeaf: true,
}

export function WorkflowNode({ data }: WorkflowNodeProps) {
  const {
    id,
    instance,
    ports,
    color,
    schemaName,
    expandedInputs,
    expandedOutputs,
    onTogglePort,
    onInputValueChange,
    workflowPath,
    nodeBreakpoint,
    portBreakpoints,
    issues,
    tests,
    gitChange,
    onClearCondition,
    onSwitchCasesChange,
  } = data as unknown as WorkflowNodeData
  const providers = useProvidersStore((s) => s.nodes[instance.uses])
  const errorCount = issues?.filter((i) => i.severity === "error").length ?? 0
  const warningCount = (issues?.length ?? 0) - errorCount

  const isSelected = useSelectionStore((s) => s.selectedNodeId === id)
  const isCore = instance.uses.startsWith("@core/")
  const isLocal = instance.uses.startsWith("./")
  const kindLabel = isCore ? "core" : isLocal ? "node" : "external"
  // Display name precedence:
  //   1. instance.label  — explicit user-set label on this specific drop.
  //   2. schemaName      — the node's own `defineNode({ name })` (or @core
  //      built-in). Authoritative human-readable name; this is what avoids
  //      disambiguation suffixes like `save-user-2` showing in the header.
  //   3. labelFromUses   — derive from the `uses` path when the schema is
  //      absent or doesn't declare a name.
  //   4. id              — last-resort fallback.
  const displayName = instance.label ?? schemaName ?? idFromUses(instance.uses) ?? id
  const safePorts: NodePorts = ports ?? {
    inputs: EMPTY_ROOT_INPUT,
    outputs: [],
  }

  // Triggers (and other nodes that take no input) shouldn't show the synthetic
  // root branch — it would be a dead-end leaf with no handle. We detect this
  // by an empty leaf root.
  const showInputRoot = !(
    safePorts.inputs.id === "" &&
    safePorts.inputs.isLeaf &&
    safePorts.inputs.children.length === 0
  )

  const nodeStatus = (
    data as { nodeStatus?: "running" | "completed" | "errored" | "paused" | "skipped" }
  ).nodeStatus
  const statusClass =
    nodeStatus === "running"
      ? "lorien-running"
      : nodeStatus === "completed"
        ? "lorien-completed"
        : nodeStatus === "errored"
          ? "lorien-errored"
          : nodeStatus === "paused"
            ? "lorien-paused"
            : nodeStatus === "skipped"
              ? "lorien-skipped"
              : ""
  const condition = parseCondition(instance.when)

  const accent = color ? resolveAccentColor(color) : null
  // The header carries the node's colour: its accent when it declares one,
  // otherwise the colour of its kind. Mixed in sRGB so low-chroma card colours
  // don't drag the hue around the wheel.
  const tint = nodeTint(instance.uses, color)
  const headerBg = `color-mix(in srgb, ${tint} 10%, var(--popover))`
  const cardBg = accent ? `color-mix(in srgb, ${accent} 6%, var(--popover))` : undefined

  const hasOutputs = safePorts.outputs.length > 0
  // A switch's case outputs are edited in place, so they get their own rows.
  const isSwitch = instance.uses === SWITCH_USES
  const outputPorts = isSwitch
    ? safePorts.outputs.filter((p) => !CASE_PORT.test(p.id))
    : safePorts.outputs

  return (
    <div
      data-testid="node-card"
      className={cn(
        "group rounded-[10px] border border-input bg-popover text-[12px] text-card-foreground shadow-[0_10px_24px_rgba(0,0,0,.18)]",
        errorCount > 0 ? "border-destructive/70" : warningCount > 0 && "border-warning/70",
        isSelected && "ring-2 ring-primary",
        statusClass,
      )}
      style={{
        width: NODE_WIDTH,
        position: "relative",
        ...(cardBg ? { background: cardBg } : {}),
      }}
    >
      {/* Header — also the drag handle for React Flow's dragHandle prop */}
      <div
        data-testid="node-header"
        className="node-drag-handle relative flex h-[34px] items-center gap-[7px] rounded-t-[10px] border-b border-border px-3"
        style={{ background: headerBg }}
      >
        {nodeBreakpoint?.before && (
          <span
            data-testid="node-breakpoint-dot-before"
            className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-destructive"
            role="img"
            aria-label="Breakpoint before this node"
          />
        )}
        {nodeBreakpoint?.after && (
          <span
            data-testid="node-breakpoint-dot-after"
            className="absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-destructive"
            role="img"
            aria-label="Breakpoint after this node"
          />
        )}
        <span
          className="shrink-0 rounded px-[5px] py-[2px] font-semibold text-[9.5px] uppercase tracking-[0.06em]"
          style={{ color: tint, background: `color-mix(in srgb, ${tint} 15%, transparent)` }}
        >
          {kindLabel}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold text-[13px]">{displayName}</span>
        {gitChange && <GitChangeMark change={gitChange} />}
        {tests && tests.run > 0 && <TestsBadge tests={tests} />}
        {issues && issues.length > 0 && <IssueBadge issues={issues} errorCount={errorCount} />}
        {!condition && !TRIGGERS.has(instance.uses) && <IdleConditionHandle />}
      </div>

      {condition && <ConditionStrip condition={condition} onClear={onClearCondition} />}

      {instance.uses === "@core/http-request" && workflowPath && (
        <GuardedBy workflowPath={workflowPath} />
      )}

      <div className="flex flex-col pt-1.5 pb-1">
        {showInputRoot && (
          <PortRow
            port={safePorts.inputs}
            depth={0}
            side="input"
            expandedSet={expandedInputs}
            onToggle={onTogglePort}
            instanceIn={instance.in}
            instanceValues={instance.values}
            workflowPath={workflowPath}
            onInputValueChange={onInputValueChange}
          />
        )}
        {showInputRoot && hasOutputs && <span className="mx-0 my-1.5 h-px bg-border" />}
        {hasOutputs && (
          <>
            <SectionLabel align="right">output</SectionLabel>
            {isSwitch && (
              <SwitchCases cases={switchCases(instance)} onChange={onSwitchCasesChange} />
            )}
            <PortTree
              ports={outputPorts}
              side="output"
              expandedSet={expandedOutputs}
              onToggle={onTogglePort}
              {...(portBreakpoints !== undefined ? { portBreakpoints } : {})}
            />
          </>
        )}
      </div>

      {/* Footer — uses, and the providers its run reads */}
      <div
        data-testid="node-footer"
        className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground"
      >
        <span className="min-w-0 flex-1 truncate">{instance.uses}</span>
        {providers?.map((name) => (
          <ProviderChip key={name} name={name} className="shrink-0" />
        ))}
      </div>
    </div>
  )
}

const CASE_PORT = /^case\d+$/

/** Colour of a branch output: green when it's the positive branch, amber for false/default. */
function branchColor(portId: string): string {
  return conditionColor(portId === "false" || portId === "default")
}

/**
 * A switch's cases, one row each: the value it matches, edited in place, and
 * the branch handle that fires when it does. Values are stored as typed
 * (strings); the runtime matches primitives by their text.
 */
function SwitchCases({
  cases,
  onChange,
}: {
  cases: unknown[]
  onChange: ((cases: unknown[], removed?: number) => void) | undefined
}) {
  return (
    <div data-testid="switch-cases">
      {cases.map((value, i) => (
        <SwitchCaseRow
          // biome-ignore lint/suspicious/noArrayIndexKey: a case is its position (case1, case2, ...)
          key={i}
          index={i}
          value={value}
          {...(onChange && {
            onCommit: (next: string) => onChange(cases.map((c, j) => (j === i ? next : c))),
            onRemove: () => onChange(cases, i),
          })}
        />
      ))}
      {onChange && (
        <div className="flex justify-end px-3" style={{ height: ROW_HEIGHT }}>
          <button
            type="button"
            data-testid="switch-add-case"
            onClick={(e) => {
              e.stopPropagation()
              onChange([...cases, ""])
            }}
            className="nodrag inline-flex items-center gap-1 rounded-[5px] px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus aria-hidden className="h-3 w-3" />
            Add case
          </button>
        </div>
      )}
    </div>
  )
}

function SwitchCaseRow({
  index,
  value,
  onCommit,
  onRemove,
}: {
  index: number
  value: unknown
  onCommit?: (value: string) => void
  onRemove?: () => void
}) {
  const shown = typeof value === "string" ? value : (JSON.stringify(value) ?? "")
  const [draft, setDraft] = useState<string | null>(null)
  const id = `case${index + 1}`
  const commit = () => {
    if (draft !== null && draft !== shown) onCommit?.(draft)
    setDraft(null)
  }
  return (
    <div
      className="group/case relative flex items-center gap-1.5 pr-3 pl-2"
      style={{ height: ROW_HEIGHT }}
    >
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove case ${index + 1}`}
          title="Remove case"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/case:opacity-100"
        >
          <X aria-hidden className="h-3 w-3" />
        </button>
      )}
      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">=</span>
      <input
        aria-label={`Case ${index + 1} value`}
        data-testid={`switch-case-${index + 1}`}
        value={draft ?? shown}
        placeholder="value"
        readOnly={!onCommit}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") {
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="nodrag nopan h-5 min-w-0 flex-1 rounded-[5px] bg-accent px-[7px] font-mono text-[10.5px] text-foreground outline-none focus:ring-1 focus:ring-ring"
      />
      <Handle
        type="source"
        position={Position.Right}
        id={id}
        title={`Runs what's wired here when the value matches case ${index + 1}`}
        style={conditionHandleStyle(branchColor(id))}
      />
    </div>
  )
}

/** Condition handles are diamonds, so they don't read as data inputs. */
function conditionHandleStyle(color: string): React.CSSProperties {
  return {
    top: "50%",
    transform: "translateY(-50%) rotate(45deg)",
    width: 9,
    height: 9,
    borderRadius: 2,
    background: color,
    border: "2px solid var(--popover)",
  }
}

/**
 * The row under the header of a node that has a `when`: which output it
 * branches on, and whether it runs when that output is truthy or falsy. The
 * condition edge lands on its handle.
 */
function ConditionStrip({
  condition,
  onClear,
}: {
  condition: Condition
  onClear: (() => void) | undefined
}) {
  const color = conditionColor(condition.negate)
  return (
    <div
      data-testid="node-condition"
      className="relative flex h-[26px] items-center gap-1.5 border-b border-border pr-1.5 pl-3 text-[11px]"
      style={{ background: `color-mix(in srgb, ${color} 8%, var(--popover))` }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={WHEN_HANDLE_ID}
        style={conditionHandleStyle(color)}
      />
      <GitBranch aria-hidden className="h-3 w-3 shrink-0" style={{ color }} />
      <span className="shrink-0 text-muted-foreground">
        {condition.negate ? "Runs if not" : "Runs if"}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px]" style={{ color }}>
        {condition.ref}
      </span>
      {onClear && (
        <button
          type="button"
          aria-label="Remove condition"
          title="Remove condition"
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}
          className="nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X aria-hidden className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

/**
 * A node without a condition still takes one: drop an output on this handle
 * (left of the header) to branch on it. Hidden until the card is hovered or
 * an output is being dragged.
 */
function IdleConditionHandle() {
  const dragging = useConnection((c) => c.inProgress && c.fromHandle?.type === "source")
  return (
    <Handle
      type="target"
      position={Position.Left}
      id={WHEN_HANDLE_ID}
      title="Drop an output here to run this node only when it's true"
      className={dragging ? undefined : "opacity-0 group-hover:opacity-100"}
      style={conditionHandleStyle("var(--muted-foreground)")}
    />
  )
}

/** The `_middleware.ts` that run before this route, outermost first; each opens its file. */
function GuardedBy({ workflowPath }: { workflowPath: string }) {
  const all = useProvidersStore((s) => s.middleware)
  const chain = middlewareFor(all, workflowPath)
  if (chain.length === 0) return null
  return (
    <div
      data-testid="guarded-by"
      className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5 text-[10.5px] text-muted-foreground"
    >
      <ShieldCheck aria-hidden className="h-3 w-3 shrink-0" />
      <span>Guarded by</span>
      {chain.flatMap((m) =>
        (m.names.length > 0 ? m.names : [null]).map((name, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: a file's exports keep their order
            key={`${m.path}#${i}`}
            type="button"
            title={`Open ${m.path}`}
            onClick={(e) => {
              e.stopPropagation()
              openCodeFile(m.path)
            }}
            className="nodrag rounded bg-accent px-1.5 py-px text-foreground/85 hover:text-foreground"
          >
            {name ??
              (m.dir === "workflows" ? "_middleware" : `${m.dir.split("/").pop()}/_middleware`)}
          </button>
        )),
      )}
    </div>
  )
}

const NODE_WIDTH = 270

/**
 * A node's colour: its declared accent, otherwise the colour of its kind.
 * Shared by the card header and the minimap.
 */
export function nodeTint(uses: string, color?: string | null): string {
  if (color) return resolveAccentColor(color)
  if (uses.startsWith("@core/")) return KIND_TINT.core as string
  return (uses.startsWith("./") ? KIND_TINT.node : KIND_TINT.external) as string
}

const KIND_TINT: Record<string, string> = {
  node: "var(--ai)",
  core: "var(--info)",
  external: "var(--muted-foreground)",
}

function SectionLabel({
  children,
  align = "left",
}: {
  children: React.ReactNode
  align?: "left" | "right"
}) {
  return (
    <span
      className={cn(
        "px-3 pt-0.5 pb-1 font-semibold text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground",
        align === "right" && "text-right",
      )}
    >
      {children}
    </span>
  )
}

function PortTree({
  ports,
  side,
  expandedSet,
  onToggle,
  portBreakpoints,
}: {
  ports: PortNode[]
  side: "input" | "output"
  expandedSet: ReadonlySet<string> | undefined
  onToggle: ((side: "input" | "output", handleId: string) => void) | undefined
  portBreakpoints?: Set<string>
}) {
  return (
    <div>
      {ports.map((port) => (
        <PortRow
          key={port.id}
          port={port}
          depth={0}
          side={side}
          expandedSet={expandedSet}
          onToggle={onToggle}
          portBreakpoints={portBreakpoints}
        />
      ))}
    </div>
  )
}

function PortRow({
  port,
  depth,
  side,
  expandedSet,
  onToggle,
  instanceIn,
  instanceValues,
  workflowPath,
  onInputValueChange,
  portBreakpoints,
}: {
  port: PortNode
  depth: number
  side: "input" | "output"
  expandedSet: ReadonlySet<string> | undefined
  onToggle: ((side: "input" | "output", handleId: string) => void) | undefined
  instanceIn?: unknown
  instanceValues?: Record<string, unknown> | undefined
  workflowPath?: string | undefined
  onInputValueChange?: ((portId: string, value: unknown) => void) | undefined
  portBreakpoints?: Set<string> | undefined
}) {
  // When the editor provides controlled state, defer to it. Otherwise fall
  // back to local state (preserved for test-only usage of WorkflowNode).
  const controlled = expandedSet !== undefined
  const isExpandedControlled = controlled && expandedSet?.has(port.id) === true
  const [localExpanded, setLocalExpanded] = useState(false)
  const expanded = controlled ? isExpandedControlled : localExpanded

  // "Show more" override — applies once the user clicks to reveal hidden
  // children of a long branch. Always per-instance (no need to lift).
  const [showAllChildren, setShowAllChildren] = useState(false)

  const isRoot = side === "input" && port.id === "" && depth === 0
  const isBranch = port.children.length > 0
  const isOutput = side === "output"
  const handleType = isOutput ? "source" : "target"
  const handlePosition = isOutput ? Position.Right : Position.Left

  const toggle = () => {
    if (controlled && onToggle) {
      onToggle(side, port.id)
    } else {
      setLocalExpanded((v) => !v)
    }
  }

  const visibleChildren = showAllChildren ? port.children : port.children.slice(0, VISIBLE_COUNT)
  const hiddenCount = port.children.length - visibleChildren.length

  // What the input row shows on the right, in priority order:
  //   1. in[portId]      — a reference; shown as "← source"
  //   2. values[portId]  — a literal the user set
  //   3. schema.default  — template-expanded, shown as a default
  //   4. otherwise       — "required" when the schema requires it, else empty
  const inObj =
    typeof instanceIn === "object" && instanceIn !== null && !Array.isArray(instanceIn)
      ? (instanceIn as Record<string, string>)
      : null
  const reference = isOutput
    ? undefined
    : isRoot
      ? typeof instanceIn === "string"
        ? instanceIn
        : undefined
      : inObj?.[port.id]
  const literal = instanceValues ? instanceValues[port.id] : undefined
  const portSchema: JsonSchema | undefined = port.schema
  const schemaDefault =
    portSchema?.default !== undefined
      ? expandTemplate(portSchema.default, { workflowPath: workflowPath ?? "" })
      : undefined
  const chipState: ChipState =
    reference !== undefined
      ? "connected"
      : literal !== undefined
        ? "set"
        : schemaDefault !== undefined
          ? "default"
          : port.required
            ? "missing"
            : "empty"

  const handleColor =
    chipState === "connected"
      ? "var(--primary)"
      : chipState === "missing" && !isBranch
        ? "var(--popover)"
        : "var(--muted-foreground)"

  const chevron = isBranch ? (
    <button
      type="button"
      aria-label={expanded ? `Collapse ${port.label}` : `Expand ${port.label}`}
      aria-expanded={expanded}
      data-testid={`chevron-${port.id}`}
      onClick={(e) => {
        e.stopPropagation()
        toggle()
      }}
      className={cn(
        "nodrag inline-flex shrink-0 items-center text-muted-foreground hover:text-foreground",
        // Input objects show their size as a chip that expands the row.
        !isOutput && !isRoot
          ? "h-5 gap-1 rounded-[5px] bg-accent px-[7px] font-mono text-[10.5px]"
          : "h-4 w-4 justify-center",
      )}
    >
      {!isOutput && !isRoot ? (
        <>
          {"{…}"} {port.children.length} {port.children.length === 1 ? "field" : "fields"}
        </>
      ) : expanded ? (
        <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronRight className="h-3 w-3" />
      )}
    </button>
  ) : null

  const labelEl = (
    <span
      className={cn(
        "min-w-0 truncate",
        isRoot
          ? "font-semibold text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground"
          : chipState === "default" || chipState === "empty"
            ? "text-muted-foreground"
            : "text-foreground",
        !isRoot && !isOutput && "flex-1",
      )}
    >
      {port.label}
    </span>
  )

  let right: React.ReactNode = null
  if (!isOutput) {
    if (isRoot) {
      right =
        reference !== undefined ? (
          <ValueChip
            portId=""
            label="input"
            state="connected"
            value={undefined}
            reference={reference}
          />
        ) : !expanded && isBranch ? (
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {port.children.length} {port.children.length === 1 ? "input" : "inputs"}
          </span>
        ) : null
    } else if (isBranch) {
      right =
        reference !== undefined ? (
          <ValueChip
            portId={port.id}
            label={port.label}
            state="connected"
            value={undefined}
            reference={reference}
          />
        ) : (
          chevron
        )
    } else {
      right = (
        <ValueChip
          portId={port.id}
          label={port.label}
          state={chipState}
          value={literal !== undefined ? literal : schemaDefault}
          reference={reference}
          schema={portSchema}
          defaultValue={schemaDefault}
          onCommit={onInputValueChange}
        />
      )
    }
  }

  const indent = depth * INDENT_PX
  return (
    <>
      <div
        className="relative flex items-center gap-2"
        style={{
          height: ROW_HEIGHT,
          paddingLeft: isOutput ? 12 : 12 + (isRoot ? 0 : Math.max(0, depth - 1) * INDENT_PX),
          paddingRight: isOutput ? 12 + indent : 8,
          justifyContent: isOutput ? "flex-end" : "flex-start",
        }}
      >
        <Handle
          type={handleType}
          position={handlePosition}
          id={port.id === "" ? ROOT_HANDLE_ID : port.id}
          style={
            port.branch
              ? conditionHandleStyle(branchColor(port.id))
              : {
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 10,
                  height: 10,
                  background: handleColor,
                  border: `2px solid ${
                    chipState === "missing" && !isBranch ? "var(--destructive)" : "var(--popover)"
                  }`,
                }
          }
        />
        {isOutput && portBreakpoints?.has(port.id) && (
          <span
            data-testid={`port-breakpoint-${port.id}`}
            className="absolute rounded-full bg-destructive"
            style={{ right: -4, top: "50%", transform: "translateY(-50%)", width: 8, height: 8 }}
          />
        )}
        {isOutput ? (
          <>
            {labelEl}
            {chevron}
          </>
        ) : isRoot ? (
          <>
            {labelEl}
            {chevron}
            <span className="flex-1" />
            {right}
          </>
        ) : (
          <>
            {labelEl}
            {right}
          </>
        )}
      </div>
      {expanded && (
        <>
          {visibleChildren.map((child) => (
            <PortRow
              key={child.id}
              port={child}
              depth={depth + 1}
              side={side}
              expandedSet={expandedSet}
              onToggle={onToggle}
              instanceIn={instanceIn}
              instanceValues={instanceValues}
              workflowPath={workflowPath}
              onInputValueChange={onInputValueChange}
              portBreakpoints={portBreakpoints}
            />
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              data-testid={`show-more-${port.id}`}
              onClick={(e) => {
                e.stopPropagation()
                setShowAllChildren(true)
              }}
              className="nodrag text-[11px] text-muted-foreground hover:text-foreground"
              style={{
                paddingLeft: isOutput ? 0 : 12 + depth * INDENT_PX,
                paddingRight: isOutput ? 12 + (depth + 1) * INDENT_PX : 0,
                width: "100%",
                textAlign: isOutput ? "right" : "left",
                height: ROW_HEIGHT,
              }}
            >
              +{hiddenCount} more
            </button>
          )}
        </>
      )}
    </>
  )
}

function IssueBadge({ issues, errorCount }: { issues: Diagnostic[]; errorCount: number }) {
  const isError = errorCount > 0
  const Icon = isError ? XCircle : AlertTriangle
  const summary = issues.map((i) => i.message).join("\n")
  return (
    <span
      data-testid="node-issue-badge"
      role="img"
      aria-label={`${issues.length} ${issues.length === 1 ? "problem" : "problems"}: ${summary}`}
      title={summary}
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium",
        isError ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {issues.length}
    </span>
  )
}

function TestsBadge({ tests }: { tests: NonNullable<WorkflowNodeData["tests"]> }) {
  const ok = tests.failed === 0
  const label = ok
    ? `Tests: ${tests.passed} of ${tests.run} passing`
    : `Tests: ${tests.failed} of ${tests.run} failing`
  return (
    <span
      data-testid="node-tests-badge"
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium",
        ok ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
      )}
    >
      {ok ? (
        <FlaskConical className="h-3 w-3" aria-hidden />
      ) : (
        <XCircle className="h-3 w-3" aria-hidden />
      )}
      {ok ? tests.passed : `${tests.failed}/${tests.run}`}
    </span>
  )
}

/** A dot on the header of a node that differs from the last commit. */
export function GitChangeMark({ change }: { change: "added" | "changed" }) {
  const label = change === "added" ? "Added since the last commit" : "Changed since the last commit"
  return (
    <span
      data-testid="node-git-mark"
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        change === "added" ? "bg-success" : "bg-warning",
      )}
    />
  )
}
