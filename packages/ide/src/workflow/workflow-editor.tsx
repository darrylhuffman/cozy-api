import {
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeTypes,
  type FinalConnectionState,
  type HandleType,
  type NodeChange,
  type NodeTypes,
  ReactFlow,
  type Node as RFNode,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent as ReactMouseEvent } from "react";
import "@xyflow/react/dist/style.css";
import {
  fetchWorkflowFile,
  fetchWorkspaceSchemas,
  type NodeSchemas,
  saveFile,
  type WorkflowFile,
} from "@/lib/api";
import { subscribeToFileEvents } from "@/lib/events";
import { useTabsStore } from "@/store/tabs";
import { useThemeStore } from "@/store/theme";
import { addNode } from "./add-node";
import { deleteNode } from "./delete-node";
import { resetNodeConnections } from "./reset-node-connections";
import { removeMappings } from "./delete-edge";
import { CanvasContextMenu } from "./canvas-context-menu";
import { CommandPalette } from "./command-palette";
import { NewNodeDialog } from "./new-node-dialog";
import { NodeContextMenu } from "./node-context-menu";
import { derivePorts, type NodePorts } from "./derive-ports";
import {
  computeVisibleInputPaths,
  computeVisibleOutputPaths,
  effectiveHandle,
} from "./effective-handle";
import { computeInitialExpansion } from "./initial-expansion";
import { extractReferences } from "./parse-references";
import { PathEdge, type PathMapping } from "./path-edge";
import { WorkflowNode, ROOT_HANDLE_ID } from "./workflow-node";
import { useSelectionStore } from "@/store/selection";
import { useLiveWorkflowStore } from "@/store/live-workflow";
import { useDebugSessionStore } from "@/store/debug-session";
import { openCodeFile } from "@/lib/open-code-file";

interface Props {
  /** API path like "workflows/users/create.workflow" */
  path: string;
  /** Tab ID so we can update dirty state in the store. */
  tabId: string;
}

// Cast to NodeTypes to avoid the strict generic constraint mismatch.
// WorkflowNode accepts { data: Record<string, unknown> } which is compatible
// at runtime with what React Flow passes, but TypeScript's strict generics
// can't verify that without the full Node extension. The cast is safe.
const nodeTypes: NodeTypes = { workflow: WorkflowNode as NodeTypes[string] };
const edgeTypes: EdgeTypes = { path: PathEdge as EdgeTypes[string] };

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Per-node expanded state. `inputs` and `outputs` are sets of EXPANDED parent
 * paths (the children of those paths are visible). The path "" means the
 * synthetic root.  See `effective-handle.ts` for the visibility rule.
 */
interface NodeExpansion {
  inputs: Set<string>;
  outputs: Set<string>;
}

/** Subset of WorkflowNode's data shape that we mutate in place from the editor. */
interface WorkflowNodeDataLike {
  expandedInputs?: ReadonlySet<string>;
  expandedOutputs?: ReadonlySet<string>;
  [key: string]: unknown;
}

export function WorkflowEditor({ path, tabId }: Props) {
  const [workflow, setWorkflow] = useState<WorkflowFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<RFNode[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [dirty, setLocalDirty] = useState(false);
  const [schemas, setSchemas] = useState<Record<string, NodeSchemas>>({});
  const [expansion, setExpansion] = useState<Map<string, NodeExpansion>>(
    () => new Map(),
  );
  const theme = useThemeStore((s) => s.theme);
  const setDirty = useTabsStore((s) => s.setDirty);
  const setSelected = useSelectionStore((s) => s.setSelected);
  const nodeStatuses = useDebugSessionStore((s) => s.nodeStatuses);
  const breakpoints = useDebugSessionStore((s) => s.breakpoints);
  const toggleBreakpoint = useDebugSessionStore((s) => s.toggleBreakpoint);
  const runs = useDebugSessionStore((s) => s.runs);
  const selectedRunId = useDebugSessionStore((s) => s.selectedRunId);

  // Set of "sourceNodeId||sourceHandle" keys for edges currently flashing
  const [flashingEdges, setFlashingEdges] = useState<Set<string>>(() => new Set());
  const lastEventIdxRef = useRef<number>(-1);

  const onNodeClick = useCallback(
    (_e: ReactMouseEvent, n: RFNode) => {
      setSelected(n.id);
    },
    [setSelected],
  );

  const onPaneClick = useCallback(() => {
    setSelected(null);
  }, [setSelected]);

  // Clear selection and live-workflow store when switching away from this tab
  useEffect(() => {
    return () => {
      setSelected(null);
      useLiveWorkflowStore.getState().clearIfTab(tabId);
    };
  }, [setSelected, tabId]);

  // Always-current ref so persist callbacks don't close over stale nodes
  const nodesRef = useRef<RFNode[]>([]);
  const workflowRef = useRef<WorkflowFile | null>(null);
  // Track dirty in a ref too so the Ctrl+S handler always sees fresh value
  const dirtyRef = useRef(false);
  // Always-current ref for expansion so the node-init effect can read the
  // latest expansion state without adding it as a dependency (which would
  // cause a full node rebuild on every toggle).
  const expansionRef = useRef<Map<string, NodeExpansion>>(new Map());
  // Ref for the ReactFlow container div (for flow-coord conversion)
  const reactFlowRef = useRef<HTMLDivElement | null>(null);
  // Context menu state: client coords for popover anchor, flow coords for node placement
  const [menu, setMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    flowX: number;
    flowY: number;
  }>({ open: false, x: 0, y: 0, flowX: 0, flowY: 0 });
  // New custom node dialog state
  const [newNodeOpen, setNewNodeOpen] = useState(false);
  // Per-node right-click context menu state
  const [nodeMenu, setNodeMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    nodeId: string | null;
  }>({ open: false, x: 0, y: 0, nodeId: null });

  const markDirty = useCallback(
    (value: boolean) => {
      setLocalDirty(value);
      dirtyRef.current = value;
      setDirty(tabId, value);
    },
    [tabId, setDirty],
  );

  /** Single point that writes a new workflow state everywhere it needs to live. */
  const applyWorkflow = useCallback(
    (next: WorkflowFile) => {
      workflowRef.current = next;
      setWorkflow(next);
      useLiveWorkflowStore.getState().setLiveWorkflow(tabId, next);
    },
    [tabId],
  );

  const addNodeAt = useCallback(
    (uses: string, x: number, y: number) => {
      const wf = workflowRef.current;
      if (!wf) return;
      const next = addNode(wf, uses, { x, y });
      // No node-type-specific prefilling here. Schema defaults (declared in
      // CORE_SCHEMAS / the workspace introspector) flow through the widget
      // value priority chain instead, so a freshly-added @core/http-request
      // displays "GET" + "/users" without writing anything into the workflow
      // file. The user can override by typing — that writes to `values:`.
      applyWorkflow(next);
      markDirty(true);
    },
    [applyWorkflow, markDirty],
  );

  const onNodesDelete = useCallback(
    (deleted: RFNode[]) => {
      const wf = workflowRef.current;
      if (!wf) return;
      let next = wf;
      for (const n of deleted) {
        next = deleteNode(next, n.id);
      }
      applyWorkflow(next);
      markDirty(true);
      // Clear selection if the deleted node was selected
      const selected = useSelectionStore.getState().selectedNodeId;
      if (selected && deleted.some((n) => n.id === selected)) {
        useSelectionStore.getState().setSelected(null);
      }
    },
    [applyWorkflow, markDirty],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const wf = workflowRef.current;
      if (!wf) return;
      const allMappings: PathMapping[] = [];
      for (const e of deleted) {
        const m = (e.data as { mappings?: PathMapping[] } | undefined)?.mappings;
        if (m) allMappings.push(...m);
      }
      if (allMappings.length === 0) return;
      const next = removeMappings(wf, allMappings);
      applyWorkflow(next);
      markDirty(true);
    },
    [applyWorkflow, markDirty],
  );

  // Track whether a reconnect completed successfully to distinguish "drop on
  // empty canvas" (delete) from "re-targeted to a new handle" (keep).
  const reconnectSuccessRef = useRef(false);

  const onReconnectStart = useCallback(() => {
    reconnectSuccessRef.current = false;
  }, []);

  const onReconnect = useCallback(
    (_oldEdge: Edge, _newConnection: Connection) => {
      reconnectSuccessRef.current = true;
    },
    [],
  );

  const onReconnectEnd = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      edge: Edge,
      _handleType: HandleType,
      _connectionState: FinalConnectionState,
    ) => {
      if (!reconnectSuccessRef.current) {
        onEdgesDelete([edge]);
      }
    },
    [onEdgesDelete],
  );

  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault();
      const bounds = reactFlowRef.current?.getBoundingClientRect();
      const flowX = bounds ? event.clientX - bounds.left : event.clientX;
      const flowY = bounds ? event.clientY - bounds.top : event.clientY;
      setMenu({ open: true, x: event.clientX, y: event.clientY, flowX, flowY });
    },
    [],
  );

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, n: RFNode) => {
      event.preventDefault();
      setNodeMenu({ open: true, x: event.clientX, y: event.clientY, nodeId: n.id });
    },
    [],
  );

  const handleResetConnections = useCallback(() => {
    const id = nodeMenu.nodeId;
    const wf = workflowRef.current;
    if (!id || !wf) return;
    const next = resetNodeConnections(wf, id);
    applyWorkflow(next);
    markDirty(true);
  }, [nodeMenu.nodeId, applyWorkflow, markDirty]);

  const handleDeleteFromMenu = useCallback(() => {
    const id = nodeMenu.nodeId;
    if (!id) return;
    onNodesDelete([{ id } as RFNode]);
  }, [nodeMenu.nodeId, onNodesDelete]);

  const handleViewSource = useCallback(() => {
    const id = nodeMenu.nodeId;
    if (!id) return;
    const wf = workflowRef.current;
    const instance = wf?.nodes[id];
    if (!instance || !instance.uses.startsWith(".")) return;
    // Strip leading "./" and add ".ts" extension, then open via the shared
    // helper so the tab id (= file path) deduplicates with the files panel.
    const filePath = `${instance.uses.replace(/^\.\//, "")}.ts`;
    openCodeFile(filePath);
  }, [nodeMenu.nodeId]);

  const handleToggleBreakpointBefore = useCallback(() => {
    const id = nodeMenu.nodeId;
    if (!id) return;
    toggleBreakpoint({ workflowPath: path, nodeId: id, kind: "before" });
  }, [nodeMenu.nodeId, path, toggleBreakpoint]);

  const handleToggleBreakpointAfter = useCallback(() => {
    const id = nodeMenu.nodeId;
    if (!id) return;
    toggleBreakpoint({ workflowPath: path, nodeId: id, kind: "after" });
  }, [nodeMenu.nodeId, path, toggleBreakpoint]);

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes("application/lorien-node")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const uses = e.dataTransfer.getData("application/lorien-node");
      if (!uses) return;
      e.preventDefault();
      const bounds = reactFlowRef.current?.getBoundingClientRect();
      const x = bounds ? e.clientX - bounds.left : e.clientX;
      const y = bounds ? e.clientY - bounds.top : e.clientY;
      addNodeAt(uses, x, y);
    },
    [addNodeAt],
  );

  const doFetch = useCallback(() => {
    let alive = true;
    setError(null);
    setWorkflow(null);
    setNodes([]);
    markDirty(false);
    fetchWorkflowFile(path)
      .then((wf) => {
        if (alive) {
          applyWorkflow(wf);
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [path, markDirty, applyWorkflow]);

  useEffect(() => {
    return doFetch();
  }, [doFetch]);

  // Fetch schemas once on mount — they don't change per workflow tab
  useEffect(() => {
    let alive = true;
    fetchWorkspaceSchemas()
      .then((s) => {
        if (alive) setSchemas(s);
      })
      .catch(() => {
        // Schemas are best-effort; fall back to inference if the call fails
        if (alive) setSchemas({});
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Called when the user edits a literal value in an inline input widget on a
   * workflow node. Writes the new value into the workflow's `values:` block
   * for that port and marks the tab dirty. Connection references in `in:` are
   * never touched here — the widget is only shown when the port is
   * unconnected.
   */
  const onInputValueChange = useCallback(
    (nodeId: string, portId: string, value: unknown) => {
      const wf = workflowRef.current;
      if (!wf) return;
      const node = wf.nodes[nodeId];
      if (!node) return;
      const baseValues = node.values ? { ...node.values } : {};
      const nextValues: Record<string, unknown> = { ...baseValues, [portId]: value };
      const next: WorkflowFile = {
        ...wf,
        nodes: { ...wf.nodes, [nodeId]: { ...node, values: nextValues } },
      };
      applyWorkflow(next);
      markDirty(true);
    },
    [applyWorkflow, markDirty],
  );

  // Keep expansionRef in sync so node-init effect always sees fresh data
  expansionRef.current = expansion;

  // Toggle handler — flips the membership of `handleId` in the relevant set.
  // Uses the ref so the callback we hand down to each WorkflowNode stays
  // stable across renders (no useCallback churn from setExpansion identity).
  const onTogglePort = useCallback(
    (nodeId: string, side: "input" | "output", handleId: string) => {
      setExpansion((m) => {
        const next = new Map(m);
        const entry = next.get(nodeId) ?? { inputs: new Set(), outputs: new Set() };
        const target = side === "input" ? new Set(entry.inputs) : new Set(entry.outputs);
        if (target.has(handleId)) target.delete(handleId);
        else target.add(handleId);
        next.set(nodeId, {
          inputs: side === "input" ? target : entry.inputs,
          outputs: side === "output" ? target : entry.outputs,
        });
        return next;
      });
    },
    [],
  );

  // Derive ports once per (workflow, schemas) — shared by node init and edge
  // routing. Edge routing needs the port trees to know which handle ids are
  // actually mounted in the DOM.
  const portsByNode = useMemo<Map<string, NodePorts>>(() => {
    if (!workflow) return new Map();
    return derivePorts(workflow, schemas);
  }, [workflow, schemas]);

  // Initialise nodes whenever workflow OR schemas change
  useEffect(() => {
    if (!workflow) return;

    // Seed expansion state for newly-introduced nodes using satisfaction
    // defaults. Existing entries are kept (manual toggles persist).
    setExpansion((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, instance] of Object.entries(workflow.nodes)) {
        if (next.has(id)) continue;
        const np = portsByNode.get(id);
        if (!np) continue;
        const init = computeInitialExpansion(np, instance);
        next.set(id, init);
        changed = true;
      }
      // Drop entries for nodes that no longer exist.
      for (const id of Array.from(next.keys())) {
        if (!workflow.nodes[id]) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    const initial: RFNode[] = Object.entries(workflow.nodes).map(
      ([id, instance], i) => {
        const view = workflow.view?.[id];
        const np = portsByNode.get(id) ?? {
          inputs: { id: "", label: "input", children: [], isLeaf: true },
          outputs: [],
        };
        const schema = schemas[instance.uses];
        const color = schema?.color ?? null;
        const schemaName = schema?.name ?? null;
        // Read the current expansion state from the ref so re-runs caused by
        // onInputValueChange (workflow changes) don't reset the user's
        // expanded/collapsed state back to empty sets.
        const existingExp = expansionRef.current.get(id);
        return {
          id,
          type: "workflow",
          position: view ?? autoPosition(i),
          dragHandle: ".node-drag-handle",
          data: {
            id,
            instance,
            ports: np,
            color,
            schemaName,
            workflowPath: path,
            expandedInputs: existingExp?.inputs ?? new Set<string>(),
            expandedOutputs: existingExp?.outputs ?? new Set<string>(),
            onTogglePort: (side: "input" | "output", handleId: string) =>
              onTogglePort(id, side, handleId),
            onInputValueChange: (portId: string, value: unknown) =>
              onInputValueChange(id, portId, value),
          },
        };
      },
    );
    setNodes(initial);
    nodesRef.current = initial;
  }, [workflow, schemas, portsByNode, onTogglePort, onInputValueChange, path]);

  // Push the latest expansion state into each node's data so React Flow
  // re-renders the node when expansion changes.  Separated from initialise
  // so manual toggles don't reset position-from-drag state.
  useEffect(() => {
    setNodes((curr) => {
      let changed = false;
      const next = curr.map((n) => {
        const exp = expansion.get(n.id);
        if (!exp) return n;
        const data = n.data as WorkflowNodeDataLike;
        if (
          data.expandedInputs === exp.inputs &&
          data.expandedOutputs === exp.outputs
        ) {
          return n;
        }
        changed = true;
        return {
          ...n,
          data: { ...data, expandedInputs: exp.inputs, expandedOutputs: exp.outputs },
        };
      });
      if (!changed) return curr;
      nodesRef.current = next;
      return next;
    });
  }, [expansion]);

  // Push the latest node status from the debug-session store into each RFNode's
  // data. Separated from the node-init effect so debug status changes never
  // cause a full rebuild (and never interfere with collapse-on-edit behaviour).
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, nodeStatus: nodeStatuses.get(n.id) },
      })),
    );
  }, [nodeStatuses, setNodes]);

  // Push the latest breakpoint state into each RFNode's data so the canvas
  // renders red dots for nodes/ports that have breakpoints set.
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        const bps = breakpoints.filter(
          (b) => b.workflowPath === path && b.nodeId === n.id,
        );
        const hasNodeBreakpoint = bps.some(
          (b) => b.kind === "before" || b.kind === "after",
        );
        const portBreakpoints = new Set(
          bps
            .filter((b) => b.kind.startsWith("port:"))
            .map((b) => b.kind.slice("port:".length)),
        );
        return {
          ...n,
          data: { ...n.data, hasNodeBreakpoint, portBreakpoints },
        };
      }),
    );
  }, [breakpoints, path, setNodes]);

  // Subscribe to edge-fired events from the currently-selected run and briefly
  // flash the matching React Flow edge (300ms animated highlight).
  const currentRun = runs.find((r) => r.runId === selectedRunId) ?? runs[0];
  useEffect(() => {
    if (!currentRun) return;
    const evts = currentRun.events;
    // When a new run starts (events reset), reset the cursor
    if (evts.length === 0) {
      lastEventIdxRef.current = -1;
      return;
    }
    for (let i = lastEventIdxRef.current + 1; i < evts.length; i++) {
      const e = evts[i]!.event;
      if (e.type !== "edge-fired") continue;
      // Parse "fromNode.field" → match against edge.source + sourceHandle
      const dot = e.from.indexOf(".");
      const fromNode = dot >= 0 ? e.from.slice(0, dot) : e.from;
      const fromHandle = dot >= 0 ? e.from.slice(dot + 1) : "";
      const flashKey = `${fromNode}||${fromHandle}`;
      setFlashingEdges((prev) => {
        const next = new Set(prev);
        next.add(flashKey);
        return next;
      });
      setTimeout(() => {
        setFlashingEdges((prev) => {
          const next = new Set(prev);
          next.delete(flashKey);
          return next;
        });
      }, 300);
    }
    lastEventIdxRef.current = evts.length - 1;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRun?.events.length]);

  // When the selected run changes, reset the event cursor so we don't
  // replay events from a previous run on the next mount.
  useEffect(() => {
    lastEventIdxRef.current = -1;
  }, [selectedRunId]);

  const edges = useMemo<Edge[]>(() => {
    if (!workflow) return [];
    const refs = extractReferences(workflow);

    // Per-node visible handle paths — the set of handle ids actually mounted
    // in the DOM right now. effectiveHandle anchors each reference to the
    // deepest visible ancestor of its logical path, which is the only way to
    // produce a sourceHandle / targetHandle that React Flow can resolve when
    // expansion state and port tree shape diverge (e.g. a reference into an
    // opaque body output).
    const visibleInputsByNode = new Map<string, ReadonlySet<string>>();
    const visibleOutputsByNode = new Map<string, ReadonlySet<string>>();
    for (const [nodeId, np] of portsByNode) {
      const exp = expansion.get(nodeId);
      visibleInputsByNode.set(
        nodeId,
        computeVisibleInputPaths(np.inputs, exp?.inputs ?? new Set()),
      );
      visibleOutputsByNode.set(
        nodeId,
        computeVisibleOutputPaths(np.outputs, exp?.outputs ?? new Set()),
      );
    }

    // For each underlying reference, compute the rendered (post-collapse)
    // endpoints AND the canonical source/target paths for the hover table.
    // Then group by the effective (source, sourceHandle, target, targetHandle)
    // tuple so N per-field refs that collapse onto the same visual edge become
    // ONE merged edge carrying every underlying mapping.
    interface Routed {
      ref: (typeof refs)[number];
      renderedSource: string;
      renderedTarget: string;
      sourceFull: string;
      targetFull: string;
    }

    const routed: Routed[] = refs.map((r) => {
      const logicalSourcePath = [r.source.portId, ...r.source.remainingPath]
        .filter((s) => s.length > 0)
        .join(".");

      const srcVisible = visibleOutputsByNode.get(r.source.nodeId);
      const renderedSource = srcVisible
        ? effectiveHandle(logicalSourcePath, srcVisible)
        : logicalSourcePath;

      const tgtVisible = visibleInputsByNode.get(r.target.nodeId);
      const rawRenderedTarget = tgtVisible
        ? effectiveHandle(r.target.portId, tgtVisible)
        : r.target.portId;
      // Translate the root sentinel "" to ROOT_HANDLE_ID so the edge
      // targetHandle matches the actual rendered handle id in the DOM.
      const renderedTarget = rawRenderedTarget === "" ? ROOT_HANDLE_ID : rawRenderedTarget;

      // Full, human-readable source path: "request.body.email", "request.body",
      // or just "request" for a bare node reference.
      const sourceFull = logicalSourcePath.length > 0
        ? `${r.source.nodeId}.${logicalSourcePath}`
        : r.source.nodeId;
      // Full target descriptor. For per-field bindings: "save.email". For the
      // whole-object form (target.portId === ""), just the node id: "save".
      const targetFull = r.target.portId === ""
        ? r.target.nodeId
        : `${r.target.nodeId}.${r.target.portId}`;

      return { ref: r, renderedSource, renderedTarget, sourceFull, targetFull };
    });

    // Group by effective endpoints — anything that resolves to the same
    // (source, sourceHandle, target, targetHandle) tuple becomes one edge.
    interface Group {
      sourceNodeId: string;
      sourceHandle: string;
      targetNodeId: string;
      targetHandle: string;
      mappings: PathMapping[];
    }
    const groups = new Map<string, Group>();
    for (const entry of routed) {
      const key = [
        entry.ref.source.nodeId,
        entry.renderedSource,
        entry.ref.target.nodeId,
        entry.renderedTarget,
      ].join("||");
      const mapping: PathMapping = { source: entry.sourceFull, target: entry.targetFull };
      const existing = groups.get(key);
      if (existing) {
        existing.mappings.push(mapping);
      } else {
        groups.set(key, {
          sourceNodeId: entry.ref.source.nodeId,
          sourceHandle: entry.renderedSource,
          targetNodeId: entry.ref.target.nodeId,
          targetHandle: entry.renderedTarget,
          mappings: [mapping],
        });
      }
    }

    let edgeIdx = 0;
    return Array.from(groups.values()).map((group) => ({
      id: `e-${edgeIdx++}`,
      source: group.sourceNodeId,
      sourceHandle: group.sourceHandle,
      target: group.targetNodeId,
      targetHandle: group.targetHandle,
      type: "path",
      animated: false,
      data: { mappings: group.mappings },
    }));
  }, [workflow, expansion, portsByNode]);

  // Merge flash state into edges for display — only `animated` and
  // `style.strokeOpacity` are touched; source/target/handles are untouched.
  const displayEdges = useMemo<Edge[]>(() => {
    if (flashingEdges.size === 0) return edges;
    return edges.map((ed) => {
      const flashKey = `${ed.source}||${ed.sourceHandle ?? ""}`;
      if (!flashingEdges.has(flashKey)) return ed;
      return {
        ...ed,
        animated: true,
        style: { ...ed.style, strokeOpacity: 1 },
      };
    });
  }, [edges, flashingEdges]);

  const save = useCallback(async () => {
    const wf = workflowRef.current;
    if (!wf) return;
    setSaveState("saving");
    const newView: Record<string, { x: number; y: number }> = {};
    for (const n of nodesRef.current) {
      newView[n.id] = {
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
      };
    }
    const updated: WorkflowFile = { ...wf, view: newView };
    try {
      await saveFile(path, `${JSON.stringify(updated, null, 2)}\n`);
      // Update the in-memory workflow so subsequent saves start from the new state
      workflowRef.current = updated;
      markDirty(false);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch (e) {
      console.error("Failed to persist workflow positions:", e);
      setSaveState("error");
    }
  }, [path, markDirty]);

  // Ctrl+S / Cmd+S — global listener (fine in v1; scope to div if needed later)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Eagerly compute and store the next nodes in the ref so the Ctrl+S
      // handler always sees the latest positions.
      const next = applyNodeChanges(changes, nodesRef.current);
      nodesRef.current = next;
      setNodes(next);

      // When any drag ends, mark the tab dirty (no autosave)
      const dragEnded = changes.some(
        (c) => c.type === "position" && c.dragging === false,
      );
      if (dragEnded) {
        markDirty(true);
      }
    },
    [markDirty],
  );

  /**
   * Drag-to-connect: when the user drags from a source handle to a target
   * handle, update the target node's `in:` block with the reference string
   * `sourceNodeId.sourcePath` and mark the tab dirty. Ctrl+S persists.
   *
   * Two target shapes:
   *  - targetHandle === ROOT_HANDLE_ID  → auto-expand form: for each top-level
   *    property in the target's input schema, create a per-field reference that
   *    extends the source path by that field name. Falls back to whole-object
   *    form if no schema is available or the schema has no properties.
   *  - targetHandle !== ROOT_HANDLE_ID  → per-field form: merge into the
   *    existing object. If `in:` is currently a string, switch to object form.
   */
  const onConnect = useCallback(
    (conn: Connection) => {
      const { source, sourceHandle, target, targetHandle } = conn;
      // sourceHandle is required (ROOT_HANDLE_ID not allowed as a source — source
      // ports always carry a real port id). targetHandle may be ROOT_HANDLE_ID
      // for the root input handle (whole-object connection).
      if (!source || !target || sourceHandle == null || targetHandle == null)
        return;
      if (!sourceHandle) return;
      const refString =
        sourceHandle === "" ? source : `${source}.${sourceHandle}`;

      // Compute the next workflow synchronously off the ref so we can decide
      // whether anything actually changed (e.g. a denied confirm leaves things
      // untouched and must not dirty the tab).
      const wf = workflowRef.current;
      if (!wf) return;
      const targetNode = wf.nodes[target];
      if (!targetNode) return;

      let nextIn: string | Record<string, string>;
      // Fields whose literal values must be cleared from `values:` because a
      // reference is taking over. The connection wins over the literal.
      const valuesToClear = new Set<string>();
      // When set, drop `values:` entirely (whole-object form replaces it).
      let dropAllValues = false;

      // targetHandle === ROOT_HANDLE_ID means the user dropped onto the root
      // input port (collapsed node). Auto-expand to per-field references when
      // the target's input schema is an object with known properties; fall back
      // to whole-object string form otherwise.
      const isRootTarget = targetHandle === ROOT_HANDLE_ID;
      if (isRootTarget) {
        const targetSchema = schemas[targetNode.uses]?.inputs;
        const targetFields =
          targetSchema?.type === "object" && targetSchema.properties
            ? Object.keys(targetSchema.properties)
            : null;

        if (targetFields && targetFields.length > 0) {
          // Auto-expand: for each target field, create a per-field reference
          // extending the source path by that field name.
          const existing = targetNode.in;
          if (
            existing &&
            typeof existing === "object" &&
            Object.keys(existing).length > 0
          ) {
            const ok = window.confirm(
              `\`${target}\` has existing input bindings. Replace them with per-field connections from \`${refString}\`?`,
            );
            if (!ok) return;
          }
          const expanded: Record<string, string> = {};
          for (const field of targetFields) {
            expanded[field] = `${refString}.${field}`;
            valuesToClear.add(field);
          }
          nextIn = expanded;
        } else {
          // Target has no known schema (or schema isn't an object with properties)
          // — fall back to the whole-object string form.
          const existing = targetNode.in;
          if (
            existing &&
            typeof existing === "object" &&
            Object.keys(existing).length > 0
          ) {
            const ok = window.confirm(
              `\`${target}\` currently has per-field input bindings. Replace them with the whole-object reference \`${refString}\`?`,
            );
            if (!ok) return;
          }
          nextIn = refString;
          // Whole-object form replaces all per-field state — including any
          // literals the user had typed.
          dropAllValues = true;
        }
      } else {
        // Per-field form. Convert string-form to object-form if needed.
        const base: Record<string, string> =
          typeof targetNode.in === "string" || !targetNode.in
            ? {}
            : { ...targetNode.in };
        base[targetHandle] = refString;
        nextIn = base;
        valuesToClear.add(targetHandle);
      }

      // Clear the corresponding literal values where references now take over.
      let nextValues: Record<string, unknown> | undefined = targetNode.values;
      if (dropAllValues) {
        nextValues = undefined;
      } else if (valuesToClear.size > 0 && targetNode.values) {
        const filtered: Record<string, unknown> = {};
        let removed = false;
        for (const [k, v] of Object.entries(targetNode.values)) {
          if (valuesToClear.has(k)) {
            removed = true;
            continue;
          }
          filtered[k] = v;
        }
        if (removed) {
          nextValues = Object.keys(filtered).length > 0 ? filtered : undefined;
        }
      }

      const nextNode: typeof targetNode = { ...targetNode, in: nextIn };
      if (nextValues === undefined) {
        delete (nextNode as { values?: unknown }).values;
      } else {
        nextNode.values = nextValues;
      }

      const next: WorkflowFile = {
        ...wf,
        nodes: { ...wf.nodes, [target]: nextNode },
      };
      applyWorkflow(next);
      markDirty(true);
    },
    [applyWorkflow, markDirty, schemas],
  );

  // Subscribe to live file events — reload if the file changes externally,
  // but only when this tab doesn't have unsaved drags (don't clobber local work).
  useEffect(() => {
    return subscribeToFileEvents((e) => {
      if (e.path !== path) return;
      if (dirtyRef.current) return; // keep local state
      doFetch();
    });
  }, [path, doFetch]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
        Error loading workflow: {error}
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Loading {path}…
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" onDragOver={onDragOver} onDrop={onDrop}>
      <div ref={reactFlowRef} className="h-full w-full">
        <ReactFlow
          nodes={nodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onReconnectStart={onReconnectStart}
          onReconnect={onReconnect}
          onReconnectEnd={onReconnectEnd}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onPaneContextMenu={onPaneContextMenu}
          onNodeContextMenu={onNodeContextMenu}
          reconnectRadius={25}
          fitView
          colorMode={theme}
          nodesConnectable={true}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls />
        </ReactFlow>
      </div>
      {saveState !== "idle" && (
        <div
          className={
            saveState === "error"
              ? "absolute bottom-3 right-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs text-destructive"
              : "absolute bottom-3 right-3 rounded-md border border-border bg-card px-3 py-1 text-xs text-muted-foreground"
          }
        >
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
              ? "Saved"
              : "Save failed"}
        </div>
      )}
      {dirty && saveState === "idle" && (
        <div className="absolute bottom-3 right-3 rounded-md border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          Unsaved changes — Ctrl+S to save
        </div>
      )}
      <CommandPalette
        schemas={schemas}
        onPick={(uses) => addNodeAt(uses, 100, 100)}
      />
      <CanvasContextMenu
        open={menu.open}
        onOpenChange={(o) => setMenu((m) => ({ ...m, open: o }))}
        x={menu.x}
        y={menu.y}
        schemas={schemas}
        onPick={(uses) => addNodeAt(uses, menu.flowX, menu.flowY)}
        onNewCustomNode={() => setNewNodeOpen(true)}
      />
      <NewNodeDialog
        open={newNodeOpen}
        onOpenChange={setNewNodeOpen}
        onCreated={(uses) => {
          // Re-fetch schemas so the new node type appears in the palette
          fetchWorkspaceSchemas().then(setSchemas).catch(() => {})
          // Add a node at the last-known context-menu position
          addNodeAt(uses, menu.flowX, menu.flowY)
        }}
      />
      <NodeContextMenu
        open={nodeMenu.open}
        onOpenChange={(o) => setNodeMenu((m) => ({ ...m, open: o }))}
        x={nodeMenu.x}
        y={nodeMenu.y}
        onDelete={handleDeleteFromMenu}
        onReset={handleResetConnections}
        onToggleBreakpointBefore={handleToggleBreakpointBefore}
        onToggleBreakpointAfter={handleToggleBreakpointAfter}
        {...(nodeMenu.nodeId &&
          workflow?.nodes[nodeMenu.nodeId]?.uses.startsWith(".")
          ? { onViewSource: handleViewSource }
          : {})}
      />
    </div>
  );
}

function autoPosition(i: number): { x: number; y: number } {
  return { x: (i % 4) * 220 + 40, y: Math.floor(i / 4) * 140 + 40 };
}

/**
 * Back-compat alias — moved to `./template`. Re-exported here so existing
 * importers keep working until they migrate to importing from "./template"
 * directly.
 */
export { deriveWorkflowPath as defaultPathForWorkflow } from "./template";
