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
import { removeMappings } from "./delete-edge";
import { CanvasContextMenu } from "./canvas-context-menu";
import { CommandPalette } from "./command-palette";
import { NewNodeDialog } from "./new-node-dialog";
import { derivePorts } from "./derive-ports";
import { effectiveHandle } from "./effective-handle";
import { computeInitialExpansion } from "./initial-expansion";
import { extractReferences } from "./parse-references";
import { PathEdge, type PathMapping } from "./path-edge";
import { WorkflowNode } from "./workflow-node";
import { useSelectionStore } from "@/store/selection";

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

  // Always-current ref so persist callbacks don't close over stale nodes
  const nodesRef = useRef<RFNode[]>([]);
  const workflowRef = useRef<WorkflowFile | null>(null);
  // Track dirty in a ref too so the Ctrl+S handler always sees fresh value
  const dirtyRef = useRef(false);
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

  const markDirty = useCallback(
    (value: boolean) => {
      setLocalDirty(value);
      dirtyRef.current = value;
      setDirty(tabId, value);
    },
    [tabId, setDirty],
  );

  const addNodeAt = useCallback(
    (uses: string, x: number, y: number) => {
      const wf = workflowRef.current;
      if (!wf) return;
      const next = addNode(wf, uses, { x, y });
      workflowRef.current = next;
      setWorkflow(next);
      markDirty(true);
    },
    [markDirty],
  );

  const onNodesDelete = useCallback(
    (deleted: RFNode[]) => {
      const wf = workflowRef.current;
      if (!wf) return;
      let next = wf;
      for (const n of deleted) {
        next = deleteNode(next, n.id);
      }
      workflowRef.current = next;
      setWorkflow(next);
      markDirty(true);
      // Clear selection if the deleted node was selected
      const selected = useSelectionStore.getState().selectedNodeId;
      if (selected && deleted.some((n) => n.id === selected)) {
        useSelectionStore.getState().setSelected(null);
      }
    },
    [markDirty],
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
      workflowRef.current = next;
      setWorkflow(next);
      markDirty(true);
    },
    [markDirty],
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
          setWorkflow(wf);
          workflowRef.current = wf;
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [path, markDirty]);

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

  // Initialise nodes whenever workflow OR schemas change
  useEffect(() => {
    if (!workflow) return;
    const portsByNode = derivePorts(workflow, schemas);

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
        const color = schemas[instance.uses]?.color ?? null;
        return {
          id,
          type: "workflow",
          position: view ?? autoPosition(i),
          data: {
            id,
            instance,
            ports: np,
            color,
            // Filled in below via the per-node data merger when expansion
            // updates. Initial values here come from the *just-seeded* map.
            expandedInputs: new Set<string>(),
            expandedOutputs: new Set<string>(),
            onTogglePort: (side: "input" | "output", handleId: string) =>
              onTogglePort(id, side, handleId),
          },
        };
      },
    );
    setNodes(initial);
    nodesRef.current = initial;
  }, [workflow, schemas, onTogglePort]);

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

  const edges = useMemo<Edge[]>(() => {
    if (!workflow) return [];
    const refs = extractReferences(workflow);

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

      const srcExp = expansion.get(r.source.nodeId)?.outputs;
      const renderedSource = srcExp
        ? effectiveHandle(logicalSourcePath, srcExp)
        : logicalSourcePath;

      const tgtExp = expansion.get(r.target.nodeId)?.inputs;
      const renderedTarget = tgtExp
        ? effectiveHandle(r.target.portId, tgtExp)
        : r.target.portId;

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
  }, [workflow, expansion]);

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
   *  - targetHandle === ""  → whole-object form: `in: "source.path"`. If the
   *    node already has per-field `in:` entries, we confirm before discarding.
   *  - targetHandle !== ""  → per-field form: merge into the existing object.
   *    If `in:` is currently a string, switch to object form.
   */
  const onConnect = useCallback(
    (conn: Connection) => {
      const { source, sourceHandle, target, targetHandle } = conn;
      // sourceHandle is required (sentinel "" not allowed as a source — source
      // ports always carry a real port id). targetHandle may be "" for root.
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

      let nextIn: string | Record<string, unknown>;

      if (targetHandle === "") {
        // Whole-object form. If existing `in:` is a non-empty object,
        // confirm before discarding per-field entries.
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
      } else {
        // Per-field form. Convert string-form to object-form if needed.
        const base: Record<string, unknown> =
          typeof targetNode.in === "string" || !targetNode.in
            ? {}
            : { ...targetNode.in };
        base[targetHandle] = refString;
        nextIn = base;
      }

      const next: WorkflowFile = {
        ...wf,
        nodes: { ...wf.nodes, [target]: { ...targetNode, in: nextIn } },
      };
      workflowRef.current = next;
      setWorkflow(next);
      markDirty(true);
    },
    [markDirty],
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
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onReconnectStart={onReconnectStart}
          onReconnect={onReconnect}
          onReconnectEnd={onReconnectEnd}
          onPaneContextMenu={onPaneContextMenu}
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
    </div>
  );
}

function autoPosition(i: number): { x: number; y: number } {
  return { x: (i % 4) * 220 + 40, y: Math.floor(i / 4) * 140 + 40 };
}
