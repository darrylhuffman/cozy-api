import { Handle, Position } from "@xyflow/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { JsonSchema, NodeInstance } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSelectionStore } from "@/store/selection";
import { idFromUses } from "./add-node";
import type { NodePorts, PortNode } from "./derive-ports";
import { resolveAccentColor } from "./tailwind-colors";
import { expandTemplate } from "./template";

export interface WorkflowNodeData {
  id: string;
  instance: NodeInstance;
  ports: NodePorts;
  /** Accent color (CSS color string). When set, renders a left stripe. */
  color?: string | null;
  /**
   * Display name pulled from the node's schema (`defineNode({ name })` or a
   * `@core/*` built-in). Preferred over the technical id so duplicate drops
   * like `save-user-2` still render as "Save User".
   */
  schemaName?: string | null;
  /** Set of EXPANDED parent paths for the inputs tree. Optional — defaults to
   *  the natural "everything collapsed" state.  The editor passes this in to
   *  lift expansion state out of the node and into a single source of truth. */
  expandedInputs?: ReadonlySet<string>;
  /** Set of EXPANDED parent paths for the outputs tree. */
  expandedOutputs?: ReadonlySet<string>;
  /** Toggle callback. When provided, the node delegates toggle clicks to the
   *  editor; otherwise it falls back to local useState (for unit tests). */
  onTogglePort?: (side: "input" | "output", handleId: string) => void;
  /**
   * Called when the user edits a literal value in an inline input widget.
   * The editor writes the new value into the workflow's `values:` block and
   * marks the tab dirty.
   */
  onInputValueChange?: (portId: string, value: unknown) => void;
  /**
   * The workflow file path (e.g. "workflows/users/create.workflow"). Used to
   * expand template tokens like `{workflow_path}` in schema defaults so the
   * widget shows a sensible "/users" instead of the raw template.
   */
  workflowPath?: string;
}

// Using the xyflow NodeProps generic requires the data type to extend Node which
// carries position/measured etc. Instead we accept the full props object and
// extract `data` ourselves — this keeps our interface clean.
interface WorkflowNodeProps {
  data: Record<string, unknown>;
}

const ROW_HEIGHT = 22;
const INDENT_PX = 12;
/** When a branch has more than this many children, show a "+N more" button. */
const VISIBLE_COUNT = 6;

/**
 * React Flow requires non-empty handle ids for connections to work reliably.
 * The root input port (port.id === "") is rendered with this sentinel id so
 * that drag-to-connect on a collapsed node produces a valid connection event.
 * All edge/onConnect logic translates "$root" ↔ "" at the boundary.
 */
export const ROOT_HANDLE_ID = "$root";

const EMPTY_ROOT_INPUT: PortNode = {
  id: "",
  label: "input",
  children: [],
  isLeaf: true,
};

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
  } = data as unknown as WorkflowNodeData;

  const isSelected = useSelectionStore((s) => s.selectedNodeId === id);
  const isCore = instance.uses.startsWith("@core/");
  const isLocal = instance.uses.startsWith("./");
  const kindLabel = isCore ? "core" : isLocal ? "node" : "external";
  // Display name precedence:
  //   1. instance.label  — explicit user-set label on this specific drop.
  //   2. schemaName      — the node's own `defineNode({ name })` (or @core
  //      built-in). Authoritative human-readable name; this is what avoids
  //      disambiguation suffixes like `save-user-2` showing in the header.
  //   3. labelFromUses   — derive from the `uses` path when the schema is
  //      absent or doesn't declare a name.
  //   4. id              — last-resort fallback.
  const displayName =
    instance.label ?? schemaName ?? idFromUses(instance.uses) ?? id;
  const safePorts: NodePorts = ports ?? {
    inputs: EMPTY_ROOT_INPUT,
    outputs: [],
  };

  // Triggers (and other nodes that take no input) shouldn't show the synthetic
  // root branch — it would be a dead-end leaf with no handle. We detect this
  // by an empty leaf root.
  const showInputRoot = !(
    safePorts.inputs.id === "" &&
    safePorts.inputs.isLeaf &&
    safePorts.inputs.children.length === 0
  );

  const accent = color ? resolveAccentColor(color) : null;
  // Faint wash across the whole card. Mix the accent into both the card and
  // muted layers so the header stays a touch darker than the body.
  //
  // We mix in sRGB rather than OKLCH so that low-chroma destinations (the dark
  // theme's `--card`, which has a blue-purple hue) don't drag the result's hue
  // around the color wheel — yellow stays yellow instead of resolving into the
  // magenta arc on its way to the card's 286° hue.
  const cardBg = accent
    ? `color-mix(in srgb, ${accent} 15%, var(--card))`
    : undefined;
  const headerBg = accent
    ? `color-mix(in srgb, ${accent} 15%, var(--muted))`
    : undefined;

  return (
    <div
      data-testid="node-card"
      className={cn(
        "rounded-md border border-border bg-card text-card-foreground shadow-sm hover:brightness-98 dark:hover:brightness-115",
        isSelected && "ring-2 ring-primary",
      )}
      style={{
        width: 240,
        position: "relative",
        ...(cardBg ? { background: cardBg } : {}),
      }}
    >
      {/* Header — also the drag handle for React Flow's dragHandle prop */}
      <div
        data-testid="node-header"
        className="node-drag-handle border-b border-border bg-muted px-3 py-1.5 text-xs"
        style={headerBg ? { background: headerBg } : undefined}
      >
        <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {kindLabel}
        </div>
        <div className="truncate font-medium">{displayName}</div>
      </div>

      {/* Body — port trees side by side */}
      <div className="flex">
        <div className="flex-1 border-r border-border py-1">
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
        </div>
        <div className="flex-1 py-1">
          <PortTree
            ports={safePorts.outputs}
            side="output"
            expandedSet={expandedOutputs}
            onToggle={onTogglePort}
          />
        </div>
      </div>

      {/* Footer — uses */}
      <div
        data-testid="node-footer"
        className="truncate border-t border-border px-3 py-1 font-mono text-[10px] text-muted-foreground"
      >
        {instance.uses}
      </div>
    </div>
  );
}

function PortTree({
  ports,
  side,
  expandedSet,
  onToggle,
}: {
  ports: PortNode[];
  side: "input" | "output";
  expandedSet: ReadonlySet<string> | undefined;
  onToggle: ((side: "input" | "output", handleId: string) => void) | undefined;
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
        />
      ))}
    </div>
  );
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
}: {
  port: PortNode;
  depth: number;
  side: "input" | "output";
  expandedSet: ReadonlySet<string> | undefined;
  onToggle: ((side: "input" | "output", handleId: string) => void) | undefined;
  instanceIn?: unknown;
  instanceValues?: Record<string, unknown> | undefined;
  workflowPath?: string | undefined;
  onInputValueChange?: ((portId: string, value: unknown) => void) | undefined;
}) {
  // When the editor provides controlled state, defer to it. Otherwise fall
  // back to local state (preserved for test-only usage of WorkflowNode).
  const controlled = expandedSet !== undefined;
  const isExpandedControlled = controlled && expandedSet?.has(port.id) === true;
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlled ? isExpandedControlled : localExpanded;

  // "Show more" override — applies once the user clicks to reveal hidden
  // children of a long branch. Always per-instance (no need to lift).
  const [showAllChildren, setShowAllChildren] = useState(false);

  const isBranch = port.children.length > 0;
  const isOutput = side === "output";
  const handleType = isOutput ? "source" : "target";
  const handlePosition = isOutput ? Position.Right : Position.Left;

  const toggle = () => {
    if (controlled && onToggle) {
      onToggle(side, port.id);
    } else {
      setLocalExpanded((v) => !v);
    }
  };

  const chevron = isBranch ? (
    <button
      type="button"
      aria-label={expanded ? `Collapse ${port.label}` : `Expand ${port.label}`}
      data-testid={`chevron-${port.id}`}
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      className="inline-flex h-3 w-3 items-center justify-center text-muted-foreground hover:text-foreground"
    >
      {expanded ? (
        <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronRight className="h-3 w-3" />
      )}
    </button>
  ) : null;

  const label = (
    <span
      className={
        isBranch
          ? "truncate text-xs font-medium text-foreground"
          : "truncate text-xs text-muted-foreground"
      }
    >
      {port.label}
    </span>
  );

  const visibleChildren = showAllChildren
    ? port.children
    : port.children.slice(0, VISIBLE_COUNT);
  const hiddenCount = port.children.length - visibleChildren.length;

  // Inline value editor priority chain (input-side leaf ports only):
  //   1. instance.in[portId]      — reference; HIDE the widget (connection shown)
  //   2. instance.values[portId]  — user-typed literal; show in widget
  //   3. schema.default           — declarative default; show in widget (template-expanded)
  //   4. otherwise                — empty
  const inObj =
    !isOutput &&
    port.isLeaf &&
    typeof instanceIn === "object" &&
    instanceIn !== null &&
    !Array.isArray(instanceIn)
      ? (instanceIn as Record<string, unknown>)
      : null;
  const portHasReference = inObj ? port.id in inObj : false;
  const portLiteralValue = instanceValues ? instanceValues[port.id] : undefined;
  const portSchema: JsonSchema | undefined = port.schema;
  const portSchemaDefault =
    portSchema?.default !== undefined
      ? expandTemplate(portSchema.default, { workflowPath: workflowPath ?? "" })
      : undefined;
  // What the widget should display: literal first, then expanded schema default.
  const widgetCurrentValue =
    portLiteralValue !== undefined ? portLiteralValue : portSchemaDefault;

  const isScalar =
    portSchema !== undefined &&
    (portSchema.type === "string" ||
      portSchema.type === "number" ||
      portSchema.type === "integer" ||
      portSchema.type === "boolean" ||
      Array.isArray(portSchema.enum));

  const showInlineWidget =
    !isOutput &&
    port.isLeaf &&
    isScalar &&
    !portHasReference &&
    !!onInputValueChange;

  const inlineWidget = showInlineWidget ? (
    <InlineInputWidget
      portId={port.id}
      schema={portSchema!}
      currentValue={widgetCurrentValue}
      onChange={onInputValueChange!}
    />
  ) : null;

  return (
    <>
      <div
        className="relative flex items-center gap-1"
        style={{
          height: ROW_HEIGHT,
          paddingLeft: isOutput ? 8 + depth * INDENT_PX : 12,
          paddingRight: isOutput ? 16 + depth * INDENT_PX : 8,
          justifyContent: isOutput ? "flex-end" : "flex-start",
        }}
      >
        <Handle
          type={handleType}
          position={handlePosition}
          id={port.id === "" ? ROOT_HANDLE_ID : port.id}
          style={{
            top: "50%",
            transform: "translateY(-50%)",
            width: 10,
            height: 10,
            background: isBranch
              ? "var(--primary, oklch(0.6 0.2 270))"
              : "var(--muted-foreground)",
          }}
        />
        {isOutput ? (
          <>
            {label}
            {chevron}
          </>
        ) : (
          <>
            {chevron}
            {label}
          </>
        )}
      </div>
      {/* Inline widget sits in its own row BELOW the port label so it
          doesn't compete for horizontal space with the label text.
          Aligned flush under the port label — no extra left indent. */}
      {inlineWidget && !isOutput && (
        <div
          className="w-full"
          style={{
            paddingLeft: 8,
            paddingRight: 8,
            paddingBottom: 4,
          }}
        >
          {inlineWidget}
        </div>
      )}
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
            />
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              data-testid={`show-more-${port.id}`}
              onClick={(e) => {
                e.stopPropagation();
                setShowAllChildren(true);
              }}
              className="ml-6 text-[11px] text-muted-foreground hover:text-foreground"
              style={{
                paddingLeft: isOutput ? 0 : 8 + (depth + 1) * INDENT_PX,
                paddingRight: isOutput ? 8 + (depth + 1) * INDENT_PX : 0,
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
  );
}

// ---------------------------------------------------------------------------
// Inline input widget — renders the right control for the port's schema type
// ---------------------------------------------------------------------------

function InlineInputWidget({
  portId,
  schema,
  currentValue,
  onChange,
}: {
  portId: string;
  schema: JsonSchema;
  currentValue: unknown;
  onChange: (portId: string, value: unknown) => void;
}) {
  const baseClass =
    "h-4 w-full rounded border border-border bg-background px-1 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  // Enum → select
  if (Array.isArray(schema.enum)) {
    return (
      <select
        data-testid={`input-widget-${portId}`}
        className={`${baseClass}`}
        value={typeof currentValue === "string" ? currentValue : ""}
        onChange={(e) => {
          e.stopPropagation();
          onChange(portId, e.target.value);
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="" disabled>
          —
        </option>
        {(schema.enum as string[]).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  // Boolean → checkbox (doesn't expand full-width — checkboxes are fixed size)
  if (schema.type === "boolean") {
    return (
      <input
        type="checkbox"
        data-testid={`input-widget-${portId}`}
        className="h-3 w-3 cursor-pointer"
        checked={typeof currentValue === "boolean" ? currentValue : false}
        onChange={(e) => {
          e.stopPropagation();
          onChange(portId, e.target.checked);
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  // Number / integer → number input
  if (schema.type === "number" || schema.type === "integer") {
    return (
      <input
        type="number"
        data-testid={`input-widget-${portId}`}
        className={`${baseClass}`}
        value={typeof currentValue === "number" ? currentValue : ""}
        onChange={(e) => {
          e.stopPropagation();
          const n =
            schema.type === "integer"
              ? parseInt(e.target.value, 10)
              : parseFloat(e.target.value);
          if (!isNaN(n)) onChange(portId, n);
          else if (e.target.value === "") onChange(portId, undefined);
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  // String → text input
  return (
    <input
      type="text"
      data-testid={`input-widget-${portId}`}
      className={`${baseClass}`}
      value={typeof currentValue === "string" ? currentValue : ""}
      placeholder="value…"
      onChange={(e) => {
        e.stopPropagation();
        onChange(portId, e.target.value);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
