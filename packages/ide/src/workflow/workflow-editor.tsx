import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  type EdgeTypes,
  type FinalConnectionState,
  type HandleType,
  MiniMap,
  type NodeChange,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  type Node as RFNode,
  useReactFlow,
} from "@xyflow/react"
import type { DragEvent, MouseEvent as ReactMouseEvent } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import "@xyflow/react/dist/style.css"
import type { Breakpoint } from "@darrylondil/lorien-runtime"
import { nodeFileForUses } from "@darrylondil/lorien-runtime/cases"
import { askAi } from "@/ai/ask"
import { explainNode, fixProblems, freeform, generateCases } from "@/ai/prompts"
import { EditorNotice } from "@/components/editor-notice"
import {
  fetchGitFile,
  fetchWorkflowFile,
  parseWorkflowContent,
  saveFile,
  type WorkflowFile,
} from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"
import { openCodeFile } from "@/lib/open-code-file"
import { useCommands } from "@/store/commands"
import { confirmAction } from "@/store/confirm"
import { type NodeStatus, useDebugSessionStore } from "@/store/debug-session"
import { useGitStore } from "@/store/git"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { caseSummary, useNodeCases } from "@/store/node-cases"
import { useWorkspaceProviders } from "@/store/providers"
import { useSchemas, useSchemasStore } from "@/store/schemas"
import { useSelectionStore } from "@/store/selection"
import { CANVAS_GRID, useSettings } from "@/store/settings"
import { useTabsStore } from "@/store/tabs"
import { useActiveTheme } from "@/store/theme"
import {
  type ApplyOptions,
  isDraftDirty,
  serializeWorkflow,
  useWorkflowDrafts,
} from "@/store/workflow-drafts"
import { addNode } from "./add-node"
import { CanvasContextMenu } from "./canvas-context-menu"
import { CanvasToolbar, type SaveStatus } from "./canvas-toolbar"
import { CommandPalette } from "./command-palette"
import { ConditionEdge, type ConditionEdgeData } from "./condition-edge"
import {
  type Condition,
  conditionLabel,
  flipCondition,
  parseCondition,
  setCondition,
  WHEN_HANDLE_ID,
} from "./conditions"
import { ConnectionLine } from "./connection-line"
import { branchLabel, isBranchPort, removeSwitchCase, setSwitchCases } from "./core-nodes"
import { removeMappings } from "./delete-edge"
import { deleteNode } from "./delete-node"
import { derivePorts, type NodePorts } from "./derive-ports"
import { type Diagnostic, diagnoseWorkflow, diagnosticsByNode } from "./diagnose"
import {
  computeVisibleInputPaths,
  computeVisibleOutputPaths,
  effectiveHandle,
} from "./effective-handle"
import { duplicateNode, tidyLayout } from "./graph-ops"
import { computeInitialExpansion } from "./initial-expansion"
import { NewNodeDialog } from "./new-node-dialog"
import { NodeContextMenu } from "./node-context-menu"
import { extractReferences } from "./parse-references"
import { PathEdge, type PathMapping } from "./path-edge"
import { resetNodeConnections } from "./reset-node-connections"
import { ShortcutsDialog } from "./shortcuts-dialog"
import { VariableNode } from "./variable-node"
import {
  extractVariable,
  schemaAtPath,
  VARIABLE_USES,
  variableKind,
  variableSchema,
  variableTargets,
} from "./variables"
import { diffWorkflows, type NodeDiffState } from "./workflow-diff"
import { nodeTint, ROOT_HANDLE_ID, WorkflowNode, type WorkflowNodeData } from "./workflow-node"

interface Props {
  /** API path like "workflows/users/create.workflow" */
  path: string
  /** Tab ID so we can update dirty state in the store. */
  tabId: string
  /**
   * False while a code tab covers the editor: it stays mounted (so the
   * Inspector keeps its workflow and the viewport survives) but leaves the
   * keyboard and the menus to the code editor.
   */
  visible?: boolean
}

// Cast to NodeTypes to avoid the strict generic constraint mismatch.
// WorkflowNode accepts { data: Record<string, unknown> } which is compatible
// at runtime with what React Flow passes, but TypeScript's strict generics
// can't verify that without the full Node extension. The cast is safe.
/** Delete or Backspace removes the selected nodes and edges. */
function minimapTint(node: RFNode): string {
  const data = node.data as Partial<WorkflowNodeData>
  return data.instance ? nodeTint(data.instance.uses, data.color) : "var(--muted-foreground)"
}
/** Minimap nodes wear their card colour: a soft fill with a solid outline. */
const minimapFill = (node: RFNode) => `color-mix(in srgb, ${minimapTint(node)} 45%, var(--popover))`
const minimapStroke = (node: RFNode) => minimapTint(node)

const DELETE_KEYS = ["Delete", "Backspace"]

/** The header mark for a node that differs from the last commit. */
function markFor(state: NodeDiffState | undefined): "added" | "changed" | undefined {
  return state === "added" || state === "changed" ? state : undefined
}

const nodeTypes: NodeTypes = {
  workflow: WorkflowNode as NodeTypes[string],
  variable: VariableNode as NodeTypes[string],
}
const edgeTypes: EdgeTypes = {
  path: PathEdge as EdgeTypes[string],
  condition: ConditionEdge as EdgeTypes[string],
}

type SaveState = "idle" | "saving" | "saved" | "error"

/**
 * Per-node expanded state. `inputs` and `outputs` are sets of EXPANDED parent
 * paths (the children of those paths are visible). The path "" means the
 * synthetic root.  See `effective-handle.ts` for the visibility rule.
 */
interface NodeExpansion {
  inputs: Set<string>
  outputs: Set<string>
}

/** Subset of WorkflowNode's data shape that we mutate in place from the editor. */
interface WorkflowNodeDataLike {
  expandedInputs?: ReadonlySet<string>
  expandedOutputs?: ReadonlySet<string>
  [key: string]: unknown
}

/**
 * The canvas for one workflow tab. Editing state (the workflow, undo history,
 * dirty flag) lives in `useWorkflowDrafts` keyed by tab, so unmounting the
 * editor — switching tabs, re-docking the panel — never loses edits.
 */
export function WorkflowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  )
}

function WorkflowEditorInner({ path, tabId, visible = true }: Props) {
  const draft = useWorkflowDrafts((s) => s.drafts[tabId])
  const ownDraft = draft && draft.path === path ? draft : undefined
  const workflow = ownDraft?.workflow ?? null
  const dirty = isDraftDirty(ownDraft)
  const diskConflict = ownDraft?.diskConflict ?? null
  const canUndo = (ownDraft?.past.length ?? 0) > 0
  const canRedo = (ownDraft?.future.length ?? 0) > 0
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<RFNode[]>([])
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const schemas = useSchemas()
  useWorkspaceProviders()
  const schemasError = useSchemasStore((s) => s.error)
  const schemasLoaded = useSchemasStore((s) => s.loaded)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [externalError, setExternalError] = useState<string | null>(null)
  const [deletedOnDisk, setDeletedOnDisk] = useState(false)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const [expansion, setExpansion] = useState<Map<string, NodeExpansion>>(() => new Map())
  const colorMode = useActiveTheme().mode
  const canvasBackground = useSettings((s) => s.canvasBackground)
  const showMinimap = useSettings((s) => s.canvasMinimap)
  const snapToGrid = useSettings((s) => s.canvasSnapToGrid)
  const setDirty = useTabsStore((s) => s.setDirty)
  const setSelected = useSelectionStore((s) => s.setSelected)
  const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)
  const selectedRunEvents = useDebugSessionStore((s) => {
    const run = s.runs.find((r) => r.runId === s.selectedRunId)
    return run?.events ?? null
  })
  const selectedRunPausedFrame = useDebugSessionStore((s) => {
    const run = s.runs.find((r) => r.runId === s.selectedRunId)
    return run?.pausedFrame ?? null
  })
  const nodeStatuses = useMemo<Map<string, NodeStatus>>(() => {
    if (!selectedRunEvents) return new Map()
    const statuses = new Map<string, NodeStatus>()
    for (const e of selectedRunEvents) {
      if (e.event.type === "before-node") statuses.set(e.event.nodeId, "running")
      else if (e.event.type === "after-node") statuses.set(e.event.nodeId, "completed")
      else if (e.event.type === "error") statuses.set(e.event.nodeId, "errored")
      else if (e.event.type === "skipped") statuses.set(e.event.nodeId, "skipped")
    }
    if (selectedRunPausedFrame) statuses.set(selectedRunPausedFrame.nodeId, "paused")
    return statuses
  }, [selectedRunEvents, selectedRunPausedFrame])
  const breakpoints = useDebugSessionStore((s) => s.breakpoints)
  const toggleBreakpoint = useDebugSessionStore((s) => s.toggleBreakpoint)
  // Refs so the node-init effect can stamp the current run status and
  // breakpoints onto rebuilt nodes without depending on them (which would
  // rebuild the whole graph on every debug event).
  const nodeStatusesRef = useRef(nodeStatuses)
  nodeStatusesRef.current = nodeStatuses
  const breakpointsRef = useRef(breakpoints)
  breakpointsRef.current = breakpoints

  // Set of "sourceNodeId||sourceHandle" keys for edges currently flashing
  const [flashingEdges, setFlashingEdges] = useState<Set<string>>(() => new Set())
  const lastEventIdxRef = useRef<number>(-1)

  const onNodeClick = useCallback(
    (_e: ReactMouseEvent, n: RFNode) => {
      setSelected(n.id)
    },
    [setSelected],
  )

  const onPaneClick = useCallback(() => {
    setSelected(null)
  }, [setSelected])

  // Clear selection and live-workflow store when switching away from this tab
  useEffect(() => {
    return () => {
      setSelected(null)
      useLiveWorkflowStore.getState().clearIfTab(tabId)
    }
  }, [setSelected, tabId])

  // Always-current ref so persist callbacks don't close over stale nodes
  const nodesRef = useRef<RFNode[]>([])
  const workflowRef = useRef<WorkflowFile | null>(null)
  const selectedNodeId = useSelectionStore((s) => s.selectedNodeId)
  // Track dirty in a ref too so the Ctrl+S handler always sees fresh value
  const dirtyRef = useRef(false)
  // Always-current ref for expansion so the node-init effect can read the
  // latest expansion state without adding it as a dependency (which would
  // cause a full node rebuild on every toggle).
  const expansionRef = useRef<Map<string, NodeExpansion>>(new Map())
  // Ref for the ReactFlow container div (for flow-coord conversion)
  const reactFlowRef = useRef<HTMLDivElement | null>(null)
  // Context menu state: client coords for popover anchor, flow coords for node placement
  const [menu, setMenu] = useState<{
    open: boolean
    x: number
    y: number
    flowX: number
    flowY: number
  }>({ open: false, x: 0, y: 0, flowX: 0, flowY: 0 })
  // New custom node dialog state
  const [newNodeOpen, setNewNodeOpen] = useState(false)
  // Per-node right-click context menu state
  const [nodeMenu, setNodeMenu] = useState<{
    open: boolean
    x: number
    y: number
    nodeId: string | null
  }>({ open: false, x: 0, y: 0, nodeId: null })

  // Mirror the draft's dirty flag into the tab strip and the Ctrl+S / file
  // event handlers.
  dirtyRef.current = dirty
  useEffect(() => {
    setDirty(tabId, dirty)
  }, [tabId, dirty, setDirty])

  // Keep the ref + inspector's live copy in step with the draft (covers
  // edits, undo/redo, saves and external reloads alike).
  useEffect(() => {
    workflowRef.current = workflow
    if (workflow) useLiveWorkflowStore.getState().setLiveWorkflow(tabId, workflow)
  }, [tabId, workflow])

  /** Single point that records an edit. Every edit is one undo step. */
  const applyWorkflow = useCallback(
    (next: WorkflowFile, opts?: ApplyOptions) => {
      workflowRef.current = next
      useWorkflowDrafts.getState().apply(tabId, next, opts)
    },
    [tabId],
  )

  const undo = useCallback(() => {
    const store = useWorkflowDrafts.getState()
    if (store.undo(tabId)) {
      workflowRef.current = useWorkflowDrafts.getState().drafts[tabId]?.workflow ?? null
    }
  }, [tabId])

  const redo = useCallback(() => {
    const store = useWorkflowDrafts.getState()
    if (store.redo(tabId)) {
      workflowRef.current = useWorkflowDrafts.getState().drafts[tabId]?.workflow ?? null
    }
  }, [tabId])

  const addNodeAt = useCallback(
    (uses: string, x: number, y: number) => {
      const wf = workflowRef.current
      if (!wf) return
      const next = addNode(wf, uses, { x, y })
      // No node-type-specific prefilling here. Schema defaults (declared in
      // CORE_SCHEMAS / the workspace introspector) flow through the widget
      // value priority chain instead, so a freshly-added @core/http-request
      // displays "GET" + "/users" without writing anything into the workflow
      // file. The user can override by typing — that writes to `values:`.
      applyWorkflow(next)
    },
    [applyWorkflow],
  )

  const onNodesDelete = useCallback(
    (deleted: RFNode[]) => {
      const wf = workflowRef.current
      if (!wf) return
      let next = wf
      for (const n of deleted) {
        next = deleteNode(next, n.id)
      }
      applyWorkflow(next)
      // Clear selection if the deleted node was selected
      const selected = useSelectionStore.getState().selectedNodeId
      if (selected && deleted.some((n) => n.id === selected)) {
        useSelectionStore.getState().setSelected(null)
      }
    },
    [applyWorkflow],
  )

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const wf = workflowRef.current
      if (!wf) return
      const allMappings: PathMapping[] = []
      let next = wf
      for (const e of deleted) {
        if (e.type === "condition") {
          next = setCondition(next, e.target, null)
          continue
        }
        const m = (e.data as { mappings?: PathMapping[] } | undefined)?.mappings
        if (m) allMappings.push(...m)
      }
      if (allMappings.length > 0) next = removeMappings(next, allMappings)
      if (next !== wf) applyWorkflow(next)
    },
    [applyWorkflow],
  )

  // Track whether a reconnect completed successfully to distinguish "drop on
  // empty canvas" (delete) from "re-targeted to a new handle" (keep).
  const reconnectSuccessRef = useRef(false)

  const onReconnectStart = useCallback(() => {
    reconnectSuccessRef.current = false
  }, [])

  const onReconnect = useCallback((_oldEdge: Edge, _newConnection: Connection) => {
    reconnectSuccessRef.current = true
  }, [])

  const onReconnectEnd = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      edge: Edge,
      _handleType: HandleType,
      _connectionState: FinalConnectionState,
    ) => {
      if (!reconnectSuccessRef.current) {
        onEdgesDelete([edge])
      }
    },
    [onEdgesDelete],
  )

  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault()
      // Convert through the viewport so the node lands under the cursor even
      // after the canvas has been panned or zoomed.
      const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setMenu({ open: true, x: event.clientX, y: event.clientY, flowX: flow.x, flowY: flow.y })
    },
    [screenToFlowPosition],
  )

  const onNodeContextMenu = useCallback((event: ReactMouseEvent, n: RFNode) => {
    event.preventDefault()
    setNodeMenu({ open: true, x: event.clientX, y: event.clientY, nodeId: n.id })
  }, [])

  const aiForNode = useCallback(
    (kind: "explain" | "cases") => {
      const id = nodeMenu.nodeId
      const wf = workflowRef.current
      const inst = id ? wf?.nodes[id] : undefined
      if (!id || !wf || !inst) return
      const schema = useSchemasStore.getState().schemas[inst.uses]
      if (kind === "explain") {
        askAi(
          explainNode({ workflowPath: path, workflow: wf, nodeId: id, uses: inst.uses, schema }),
        )
      } else {
        const file = nodeFileForUses(inst.uses)
        const existing = file ? (useNodeCases.getState().byNode[file]?.file.cases ?? []) : []
        askAi(generateCases({ uses: inst.uses, schema, existing }))
      }
    },
    [nodeMenu.nodeId, path],
  )

  const askAboutWorkflow = useCallback(
    (question: string) => {
      const wf = workflowRef.current
      const id = useSelectionStore.getState().selectedNodeId
      const inst = id ? wf?.nodes[id] : undefined
      askAi(
        freeform({
          ask: question,
          workflowPath: path,
          workflow: wf,
          selected:
            id && inst
              ? {
                  nodeId: id,
                  uses: inst.uses,
                  schema: useSchemasStore.getState().schemas[inst.uses],
                }
              : null,
        }),
      )
    },
    [path],
  )

  const handleResetConnections = useCallback(() => {
    const id = nodeMenu.nodeId
    const wf = workflowRef.current
    if (!id || !wf) return
    const next = resetNodeConnections(wf, id)
    applyWorkflow(next)
  }, [nodeMenu.nodeId, applyWorkflow])

  const handleDeleteFromMenu = useCallback(() => {
    const id = nodeMenu.nodeId
    if (!id) return
    onNodesDelete([{ id } as RFNode])
  }, [nodeMenu.nodeId, onNodesDelete])

  const duplicate = useCallback(
    (id: string) => {
      const wf = workflowRef.current
      if (!wf) return
      const pos = nodesRef.current.find((n) => n.id === id)?.position
      const result = duplicateNode(wf, id, pos)
      if (!result) return
      applyWorkflow(result.workflow)
      setSelected(result.id)
    },
    [applyWorkflow, setSelected],
  )

  const tidy = useCallback(() => {
    const wf = workflowRef.current
    if (!wf || Object.keys(wf.nodes).length === 0) return
    const heights: Record<string, number> = {}
    for (const n of nodesRef.current) {
      if (n.measured?.height) heights[n.id] = n.measured.height
    }
    applyWorkflow(tidyLayout(wf, { heights }))
    // Let React Flow apply the new positions before framing them.
    setTimeout(() => void fitView({ padding: 0.2, duration: 250 }), 50)
  }, [applyWorkflow, fitView])

  const focusNode = useCallback(
    (id: string) => {
      setSelected(id)
      void fitView({ nodes: [{ id }], padding: 0.6, maxZoom: 1.2, duration: 250 })
    },
    [fitView, setSelected],
  )

  const handleViewSource = useCallback(() => {
    const id = nodeMenu.nodeId
    if (!id) return
    const wf = workflowRef.current
    const instance = wf?.nodes[id]
    if (!instance?.uses.startsWith(".")) return
    // Strip leading "./" and add ".ts" extension, then open via the shared
    // helper so the tab id (= file path) deduplicates with the files panel.
    const filePath = `${instance.uses.replace(/^\.\//, "")}.ts`
    openCodeFile(filePath)
  }, [nodeMenu.nodeId])

  const handleToggleBreakpointBefore = useCallback(() => {
    const id = nodeMenu.nodeId
    if (!id) return
    toggleBreakpoint({ workflowPath: path, nodeId: id, kind: "before" })
  }, [nodeMenu.nodeId, path, toggleBreakpoint])

  const handleToggleBreakpointAfter = useCallback(() => {
    const id = nodeMenu.nodeId
    if (!id) return
    toggleBreakpoint({ workflowPath: path, nodeId: id, kind: "after" })
  }, [nodeMenu.nodeId, path, toggleBreakpoint])

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes("application/lorien-node")) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
    }
  }, [])

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const uses = e.dataTransfer.getData("application/lorien-node")
      if (!uses) return
      e.preventDefault()
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      addNodeAt(uses, flow.x, flow.y)
    },
    [addNodeAt, screenToFlowPosition],
  )

  /** Flow coordinates of the visible canvas centre — where palette picks land. */
  const viewportCenter = useCallback((): { x: number; y: number } => {
    const bounds = reactFlowRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width === 0) return { x: 100, y: 100 }
    const c = screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    })
    // Offset by half a node card so the card, not its corner, is centred.
    return { x: c.x - 120, y: c.y - 40 }
  }, [screenToFlowPosition])

  /** (Re)load the file from disk into this tab's draft, dropping local edits. */
  const loadFromDisk = useCallback(() => {
    let alive = true
    setError(null)
    fetchWorkflowFile(path)
      .then((wf) => {
        if (!alive) return
        useWorkflowDrafts.getState().load(tabId, path, wf)
        setDeletedOnDisk(false)
        setExternalError(null)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [path, tabId])

  // Only hit the disk when this tab has no draft yet — a remount (tab switch)
  // must resume the in-memory edits instead of clobbering them.
  useEffect(() => {
    const existing = useWorkflowDrafts.getState().drafts[tabId]
    if (existing && existing.path === path) return
    return loadFromDisk()
  }, [loadFromDisk, path, tabId])

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const reloadSchemas = useCallback(() => {
    void useSchemasStore.getState().refresh()
  }, [])

  /**
   * Called when the user edits a literal value in an inline input widget on a
   * workflow node. Writes the new value into the workflow's `values:` block
   * for that port and marks the tab dirty. Connection references in `in:` are
   * never touched here — the widget is only shown when the port is
   * unconnected.
   */
  const onInputValueChange = useCallback(
    (nodeId: string, portId: string, value: unknown) => {
      const wf = workflowRef.current
      if (!wf) return
      const node = wf.nodes[nodeId]
      if (!node) return
      const baseValues = node.values ? { ...node.values } : {}
      const nextValues: Record<string, unknown> = { ...baseValues, [portId]: value }
      // Clearing a value falls back to the schema default.
      if (value === undefined) delete nextValues[portId]
      const next: WorkflowFile = {
        ...wf,
        nodes: { ...wf.nodes, [nodeId]: { ...node, values: nextValues } },
      }
      // Typing into one field is one undo step, not one per keystroke.
      applyWorkflow(next, { coalesceKey: `value:${nodeId}:${portId}` })
    },
    [applyWorkflow],
  )

  /** Removes a node's `when`, or flips it between truthy and falsy. */
  const onClearCondition = useCallback(
    (nodeId: string) => {
      const wf = workflowRef.current
      if (wf) applyWorkflow(setCondition(wf, nodeId, null))
    },
    [applyWorkflow],
  )
  /** Edits a switch's cases; removing one renumbers what read the later ones. */
  const onSwitchCasesChange = useCallback(
    (nodeId: string, cases: unknown[], removed?: number) => {
      const wf = workflowRef.current
      if (!wf) return
      applyWorkflow(
        removed === undefined
          ? setSwitchCases(wf, nodeId, cases)
          : removeSwitchCase(wf, nodeId, removed),
      )
    },
    [applyWorkflow],
  )
  const onFlipCondition = useCallback(
    (nodeId: string) => {
      const wf = workflowRef.current
      if (wf) applyWorkflow(flipCondition(wf, nodeId))
    },
    [applyWorkflow],
  )

  // Keep expansionRef in sync so node-init effect always sees fresh data
  expansionRef.current = expansion

  // Toggle handler — flips the membership of `handleId` in the relevant set.
  // Uses the ref so the callback we hand down to each WorkflowNode stays
  // stable across renders (no useCallback churn from setExpansion identity).
  const onTogglePort = useCallback((nodeId: string, side: "input" | "output", handleId: string) => {
    setExpansion((m) => {
      const next = new Map(m)
      const entry = next.get(nodeId) ?? { inputs: new Set(), outputs: new Set() }
      const target = side === "input" ? new Set(entry.inputs) : new Set(entry.outputs)
      if (target.has(handleId)) target.delete(handleId)
      else target.add(handleId)
      next.set(nodeId, {
        inputs: side === "input" ? target : entry.inputs,
        outputs: side === "output" ? target : entry.outputs,
      })
      return next
    })
  }, [])

  // Derive ports once per (workflow, schemas) — shared by node init and edge
  // routing. Edge routing needs the port trees to know which handle ids are
  // actually mounted in the DOM.
  // Live problems: bad references, unknown node types, missing required
  // inputs, cycles. Recomputed on every edit — it's a cheap pass.
  const diagnostics = useMemo<Diagnostic[]>(
    () => (workflow ? diagnoseWorkflow(workflow, schemas, { schemasLoaded }) : []),
    [workflow, schemas, schemasLoaded],
  )
  const issuesByNode = useMemo(() => diagnosticsByNode(diagnostics), [diagnostics])
  const caseFiles = useNodeCases((s) => s.byNode)
  const caseResults = useNodeCases((s) => s.results)
  const testsByUses = useMemo(() => {
    const out = new Map<string, ReturnType<typeof caseSummary>>()
    for (const inst of Object.values(workflow?.nodes ?? {})) {
      const file = nodeFileForUses(inst.uses)
      if (!file || out.has(inst.uses)) continue
      const summary = caseSummary({ byNode: caseFiles, results: caseResults }, file)
      if (summary && summary.run > 0) out.set(inst.uses, summary)
    }
    return out
  }, [workflow, caseFiles, caseResults])
  const testsByUsesRef = useRef(testsByUses)
  testsByUsesRef.current = testsByUses

  const portsByNode = useMemo<Map<string, NodePorts>>(() => {
    if (!workflow) return new Map()
    return derivePorts(workflow, schemas)
  }, [workflow, schemas])

  // Initialise nodes whenever workflow OR schemas change
  useEffect(() => {
    if (!workflow) return

    // Seed expansion state for newly-introduced nodes using satisfaction
    // defaults. Existing entries are kept (manual toggles persist).
    setExpansion((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const [id, instance] of Object.entries(workflow.nodes)) {
        if (next.has(id)) continue
        const np = portsByNode.get(id)
        if (!np) continue
        const init = computeInitialExpansion(np, instance)
        next.set(id, init)
        changed = true
      }
      // Drop entries for nodes that no longer exist.
      for (const id of Array.from(next.keys())) {
        if (!workflow.nodes[id]) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : prev
    })

    const initial: RFNode[] = Object.entries(workflow.nodes).map(([id, instance], i) => {
      const view = workflow.view?.[id]
      const np = portsByNode.get(id) ?? {
        inputs: { id: "", label: "input", children: [], isLeaf: true },
        outputs: [],
      }
      const schema = schemas[instance.uses]
      const color = schema?.color ?? null
      const schemaName = schema?.name ?? null
      // Read the current expansion state from the ref so re-runs caused by
      // onInputValueChange (workflow changes) don't reset the user's
      // expanded/collapsed state back to empty sets.
      const existingExp = expansionRef.current.get(id)
      const bp = breakpointDataFor(breakpointsRef.current, path, id)
      if (instance.uses === VARIABLE_USES) {
        return {
          id,
          type: "variable",
          position: view ?? autoPosition(i),
          dragHandle: ".node-drag-handle",
          data: {
            id,
            instance,
            schema: variableSchema(workflow, schemas, id),
            targets: variableTargets(workflow, id),
            onValueChange: (value: unknown) => onInputValueChange(id, "value", value),
            nodeStatus: nodeStatusesRef.current.get(id),
            issues: issuesByNode.get(id),
            gitChange: markFor(changeMarksRef.current[id]),
          },
        }
      }
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
          onClearCondition: () => onClearCondition(id),
          onSwitchCasesChange: (cases: unknown[], removed?: number) =>
            onSwitchCasesChange(id, cases, removed),
          nodeStatus: nodeStatusesRef.current.get(id),
          issues: issuesByNode.get(id),
          tests: testsByUsesRef.current.get(instance.uses) ?? null,
          nodeBreakpoint: bp.nodeBreakpoint,
          portBreakpoints: bp.portBreakpoints,
          gitChange: markFor(changeMarksRef.current[id]),
        },
      }
    })
    setNodes(initial)
    nodesRef.current = initial
  }, [
    workflow,
    schemas,
    portsByNode,
    issuesByNode,
    onTogglePort,
    onInputValueChange,
    onClearCondition,
    onSwitchCasesChange,
    path,
  ])

  // Nodes added or changed since the last commit get a mark on their header.
  const gitStatus = useGitStore((s) => s.status)
  const [committed, setCommitted] = useState<WorkflowFile | null>(null)
  // Re-read HEAD whenever git status changes (a commit moves it).
  useEffect(() => {
    if (!gitStatus?.repo) {
      setCommitted(null)
      return
    }
    let alive = true
    fetchGitFile(path, "HEAD")
      .then((text) => {
        if (!alive) return
        try {
          setCommitted(text === null ? null : parseWorkflowContent(path, text))
        } catch {
          setCommitted(null)
        }
      })
      .catch(() => {
        if (alive) setCommitted(null)
      })
    return () => {
      alive = false
    }
  }, [path, gitStatus])
  const changeMarks = useMemo<Record<string, NodeDiffState>>(
    () => (committed && workflow ? diffWorkflows(committed, workflow).nodes : {}),
    [committed, workflow],
  )
  const changeMarksRef = useRef(changeMarks)
  changeMarksRef.current = changeMarks
  useEffect(() => {
    setNodes((curr) => {
      let changed = false
      const next = curr.map((n) => {
        const gitChange = markFor(changeMarks[n.id])
        if ((n.data as { gitChange?: string }).gitChange === gitChange) return n
        changed = true
        return { ...n, data: { ...n.data, gitChange } }
      })
      if (!changed) return curr
      nodesRef.current = next
      return next
    })
  }, [changeMarks])

  // Node test results (from the Tests tab) as pass/fail badges on the cards.
  // Patched into existing nodes so a test run doesn't rebuild the canvas.
  useEffect(() => {
    setNodes((curr) => {
      let changed = false
      const next = curr.map((n) => {
        const data = n.data as { instance?: { uses: string }; tests?: unknown }
        const t = data.instance ? (testsByUses.get(data.instance.uses) ?? null) : null
        if (JSON.stringify(data.tests ?? null) === JSON.stringify(t)) return n
        changed = true
        return { ...n, data: { ...n.data, tests: t } }
      })
      if (!changed) return curr
      nodesRef.current = next
      return next
    })
  }, [testsByUses])

  // Push the latest expansion state into each node's data so React Flow
  // re-renders the node when expansion changes.  Separated from initialise
  // so manual toggles don't reset position-from-drag state.
  useEffect(() => {
    setNodes((curr) => {
      let changed = false
      const next = curr.map((n) => {
        const exp = expansion.get(n.id)
        if (!exp) return n
        const data = n.data as WorkflowNodeDataLike
        if (data.expandedInputs === exp.inputs && data.expandedOutputs === exp.outputs) {
          return n
        }
        changed = true
        return {
          ...n,
          data: { ...data, expandedInputs: exp.inputs, expandedOutputs: exp.outputs },
        }
      })
      if (!changed) return curr
      nodesRef.current = next
      return next
    })
  }, [expansion])

  // Push the latest node status from the debug-session store into each RFNode's
  // data. Separated from the node-init effect so debug status changes never
  // cause a full rebuild (and never interfere with collapse-on-edit behaviour).
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, nodeStatus: nodeStatuses.get(n.id) },
      })),
    )
  }, [nodeStatuses])

  // Push the latest breakpoint state into each RFNode's data so the canvas
  // renders red dots for nodes/ports that have breakpoints set.
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, ...breakpointDataFor(breakpoints, path, n.id) },
      })),
    )
  }, [breakpoints, path])

  // Subscribe to edge-fired events from the currently-selected run and briefly
  // flash the matching React Flow edge (300ms animated highlight).
  const currentRun = useDebugSessionStore((s) => s.selectedRun())
  // biome-ignore lint/correctness/useExhaustiveDependencies: replays only new events; re-running on every run object change would re-flash edges
  useEffect(() => {
    if (!currentRun) return
    const evts = currentRun.events
    // When a new run starts (events reset), reset the cursor
    if (evts.length === 0) {
      lastEventIdxRef.current = -1
      return
    }
    for (let i = lastEventIdxRef.current + 1; i < evts.length; i++) {
      const e = evts[i]!.event
      if (e.type !== "edge-fired") continue
      // Parse "fromNode.field" → match against edge.source + sourceHandle
      const dot = e.from.indexOf(".")
      const fromNode = dot >= 0 ? e.from.slice(0, dot) : e.from
      const fromHandle = dot >= 0 ? e.from.slice(dot + 1) : ""
      const flashKey = `${fromNode}||${fromHandle}`
      setFlashingEdges((prev) => {
        const next = new Set(prev)
        next.add(flashKey)
        return next
      })
      setTimeout(() => {
        setFlashingEdges((prev) => {
          const next = new Set(prev)
          next.delete(flashKey)
          return next
        })
      }, 300)
    }
    lastEventIdxRef.current = evts.length - 1
  }, [currentRun?.events.length])

  // When the selected run changes, reset the event cursor so we don't
  // replay events from a previous run on the next mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets the cursor whenever the selected run changes
  useEffect(() => {
    lastEventIdxRef.current = -1
  }, [selectedRunId])

  const edges = useMemo<Edge[]>(() => {
    if (!workflow) return []
    const refs = extractReferences(workflow)

    // Per-node visible handle paths — the set of handle ids actually mounted
    // in the DOM right now. effectiveHandle anchors each reference to the
    // deepest visible ancestor of its logical path, which is the only way to
    // produce a sourceHandle / targetHandle that React Flow can resolve when
    // expansion state and port tree shape diverge (e.g. a reference into an
    // opaque body output).
    const visibleInputsByNode = new Map<string, ReadonlySet<string>>()
    const visibleOutputsByNode = new Map<string, ReadonlySet<string>>()
    for (const [nodeId, np] of portsByNode) {
      const exp = expansion.get(nodeId)
      visibleInputsByNode.set(nodeId, computeVisibleInputPaths(np.inputs, exp?.inputs ?? new Set()))
      visibleOutputsByNode.set(
        nodeId,
        computeVisibleOutputPaths(np.outputs, exp?.outputs ?? new Set()),
      )
    }

    // For each underlying reference, compute the rendered (post-collapse)
    // endpoints AND the canonical source/target paths for the hover table.
    // Then group by the effective (source, sourceHandle, target, targetHandle)
    // tuple so N per-field refs that collapse onto the same visual edge become
    // ONE merged edge carrying every underlying mapping.
    interface Routed {
      ref: (typeof refs)[number]
      renderedSource: string
      renderedTarget: string
      sourceFull: string
      targetFull: string
    }

    const routed: Routed[] = refs.map((r) => {
      const logicalSourcePath = [r.source.portId, ...r.source.remainingPath]
        .filter((s) => s.length > 0)
        .join(".")

      const srcVisible = visibleOutputsByNode.get(r.source.nodeId)
      const renderedSource = srcVisible
        ? effectiveHandle(logicalSourcePath, srcVisible)
        : logicalSourcePath

      const tgtVisible = visibleInputsByNode.get(r.target.nodeId)
      const rawRenderedTarget = tgtVisible
        ? effectiveHandle(r.target.portId, tgtVisible)
        : r.target.portId
      // Translate the root sentinel "" to ROOT_HANDLE_ID so the edge
      // targetHandle matches the actual rendered handle id in the DOM.
      const renderedTarget = rawRenderedTarget === "" ? ROOT_HANDLE_ID : rawRenderedTarget

      // Full, human-readable source path: "request.body.email", "request.body",
      // or just "request" for a bare node reference.
      const sourceFull =
        logicalSourcePath.length > 0 ? `${r.source.nodeId}.${logicalSourcePath}` : r.source.nodeId
      // Full target descriptor. For per-field bindings: "save.email". For the
      // whole-object form (target.portId === ""), just the node id: "save".
      const targetFull =
        r.target.portId === "" ? r.target.nodeId : `${r.target.nodeId}.${r.target.portId}`

      return { ref: r, renderedSource, renderedTarget, sourceFull, targetFull }
    })

    // Group by effective endpoints — anything that resolves to the same
    // (source, sourceHandle, target, targetHandle) tuple becomes one edge.
    interface Group {
      sourceNodeId: string
      sourceHandle: string
      targetNodeId: string
      targetHandle: string
      mappings: PathMapping[]
    }
    const groups = new Map<string, Group>()
    for (const entry of routed) {
      const key = [
        entry.ref.source.nodeId,
        entry.renderedSource,
        entry.ref.target.nodeId,
        entry.renderedTarget,
      ].join("||")
      const mapping: PathMapping = { source: entry.sourceFull, target: entry.targetFull }
      const existing = groups.get(key)
      if (existing) {
        existing.mappings.push(mapping)
      } else {
        groups.set(key, {
          sourceNodeId: entry.ref.source.nodeId,
          sourceHandle: entry.renderedSource,
          targetNodeId: entry.ref.target.nodeId,
          targetHandle: entry.renderedTarget,
          mappings: [mapping],
        })
      }
    }

    let edgeIdx = 0
    const dataEdges: Edge[] = Array.from(groups.values()).map((group) => ({
      id: `e-${edgeIdx++}`,
      source: group.sourceNodeId,
      sourceHandle: group.sourceHandle,
      target: group.targetNodeId,
      targetHandle: group.targetHandle,
      type: "path",
      animated: false,
      data: { mappings: group.mappings },
    }))

    // `when` conditions: a dashed edge from the output a node branches on
    // into its condition handle, labelled with the branch it takes.
    const conditionEdges: Edge[] = []
    for (const [nodeId, instance] of Object.entries(workflow.nodes)) {
      const c = parseCondition(instance.when)
      if (!c || c.nodeId === nodeId || !workflow.nodes[c.nodeId]) continue
      const outputs = portsByNode.get(c.nodeId)?.outputs ?? []
      const visible = visibleOutputsByNode.get(c.nodeId) ?? new Set<string>()
      // A bare node reference ("when": "FindRoom") anchors on its first output.
      const sourceHandle = effectiveHandle(c.path.join("."), visible) || outputs[0]?.id
      if (!sourceHandle) continue
      const data: ConditionEdgeData = {
        when: instance.when as string,
        label: branchLabelFor(workflow, c) ?? conditionLabel(c),
        negate: c.negate,
      }
      conditionEdges.push({
        id: `when-${nodeId}`,
        source: c.nodeId,
        sourceHandle,
        target: nodeId,
        targetHandle: WHEN_HANDLE_ID,
        type: "condition",
        data: data as unknown as Record<string, unknown>,
      })
    }
    return [...dataEdges, ...conditionEdges]
  }, [workflow, expansion, portsByNode])

  // Merge flash state into edges for display — only `animated` and
  // `style.strokeOpacity` are touched; source/target/handles are untouched.
  const displayEdges = useMemo<Edge[]>(() => {
    return edges.map((ed) => {
      if (ed.type === "condition") {
        return { ...ed, data: { ...ed.data, onFlip: () => onFlipCondition(ed.target) } }
      }
      if (flashingEdges.size === 0) return ed
      const flashKey = `${ed.source}||${ed.sourceHandle ?? ""}`
      if (!flashingEdges.has(flashKey)) return ed
      return {
        ...ed,
        animated: true,
        style: { ...ed.style, strokeOpacity: 1 },
      }
    })
  }, [edges, flashingEdges, onFlipCondition])

  const save = useCallback(async () => {
    const wf = workflowRef.current
    if (!wf) return
    setSaveState("saving")
    setSaveError(null)
    const newView: Record<string, { x: number; y: number }> = {}
    for (const n of nodesRef.current) {
      newView[n.id] = {
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
      }
    }
    const updated: WorkflowFile = { ...wf, view: newView }
    try {
      await saveFile(path, serializeWorkflow(updated))
      // The written content is the new baseline. Edits made while the write
      // was in flight survive (markSaved only swaps in `updated` if the draft
      // is still the state we saved from).
      useWorkflowDrafts.getState().markSaved(tabId, updated, wf)
      workflowRef.current = useWorkflowDrafts.getState().drafts[tabId]?.workflow ?? updated
      setDeletedOnDisk(false)
      if (!aliveRef.current) return
      setSaveState("saved")
      setTimeout(() => {
        if (aliveRef.current) setSaveState((st) => (st === "saved" ? "idle" : st))
      }, 1500)
    } catch (e) {
      if (!aliveRef.current) return
      setSaveState("error")
      setSaveError((e as Error).message)
    }
  }, [path, tabId])

  // Keyboard: Ctrl/Cmd+S saves; Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and
  // Ctrl/Cmd+Y redo. Only one workflow editor is mounted at a time. Keys
  // typed inside the code editor or a text field keep their native meaning.
  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest(".monaco-editor")) return
      // Plain-key shortcuts, only while focus isn't in a text field.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !isTextEntry(target)) {
        if (e.key === "?") {
          e.preventDefault()
          setShortcutsOpen(true)
        } else if (e.shiftKey && (e.key === "!" || e.code === "Digit1")) {
          e.preventDefault()
          void fitView({ padding: 0.2, duration: 250 })
        }
        return
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === "s") {
        e.preventDefault()
        void save()
        return
      }
      if (isTextEntry(target)) return
      if (key === "z" && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault()
        redo()
      } else if (key === "d") {
        const selected = useSelectionStore.getState().selectedNodeId
        if (!selected) return
        e.preventDefault()
        duplicate(selected)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [visible, save, undo, redo, duplicate, fitView])

  // The title-bar menus and status bar reach the canvas through these.
  useEffect(() => {
    if (!visible) return
    return useCommands.getState().register({
      "file.save": { run: () => void save() },
      "edit.undo": { run: undo, enabled: canUndo },
      "edit.redo": { run: redo, enabled: canRedo },
      "edit.duplicate": {
        run: () => {
          if (selectedNodeId) duplicate(selectedNodeId)
        },
        enabled: Boolean(selectedNodeId),
      },
      "canvas.addNode": { run: () => setPaletteOpen(true) },
      "canvas.fitView": { run: () => void fitView({ padding: 0.2, duration: 250 }) },
      "canvas.tidy": { run: tidy },
      "help.shortcuts": { run: () => setShortcutsOpen(true) },
    })
  }, [visible, save, undo, redo, canUndo, canRedo, duplicate, selectedNodeId, fitView, tidy])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Eagerly compute and store the next nodes in the ref so the Ctrl+S
      // handler always sees the latest positions.
      const next = applyNodeChanges(changes, nodesRef.current)
      nodesRef.current = next
      setNodes(next)

      // When a drag ends, commit the new positions into the workflow's
      // `view` block — one undo step per drag, and later edits (which
      // rebuild nodes from the workflow) keep the moved positions.
      const moved = changes.filter(
        (c): c is Extract<NodeChange, { type: "position" }> =>
          c.type === "position" && c.dragging === false,
      )
      const wf = workflowRef.current
      if (moved.length > 0 && wf) {
        const view = { ...(wf.view ?? {}) }
        for (const c of moved) {
          const n = next.find((node) => node.id === c.id)
          if (!n) continue
          view[c.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
        }
        applyWorkflow({ ...wf, view })
      }
    },
    [applyWorkflow],
  )

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
  const connect = useCallback(
    (conn: Connection, confirmed = false) => {
      const { source, sourceHandle, target, targetHandle } = conn
      // sourceHandle is required (ROOT_HANDLE_ID not allowed as a source — source
      // ports always carry a real port id). targetHandle may be ROOT_HANDLE_ID
      // for the root input handle (whole-object connection).
      if (!source || !target || sourceHandle == null || targetHandle == null) return
      if (!sourceHandle) return
      const refString = sourceHandle === "" ? source : `${source}.${sourceHandle}`

      // Compute the next workflow synchronously off the ref so we can decide
      // whether anything actually changed (e.g. a denied confirm leaves things
      // untouched and must not dirty the tab).
      const wf = workflowRef.current
      if (!wf) return
      const targetNode = wf.nodes[target]
      if (!targetNode) return

      // Dropped on the condition handle (or a logic node's branch dropped
      // anywhere on a node): the node now runs only when this output is
      // truthy. Re-pointing an existing condition keeps its polarity.
      const sourceNode = wf.nodes[source]
      const fromBranch = sourceNode !== undefined && isBranchPort(sourceNode.uses, sourceHandle)
      if (targetHandle === WHEN_HANDLE_ID || fromBranch) {
        if (source === target) return
        const negate = parseCondition(targetNode.when)?.negate ?? false
        applyWorkflow(setCondition(wf, target, refString, negate))
        return
      }

      let nextIn: string | Record<string, string>
      // Fields whose literal values must be cleared from `values:` because a
      // reference is taking over. The connection wins over the literal.
      const valuesToClear = new Set<string>()
      // When set, drop `values:` entirely (whole-object form replaces it).
      let dropAllValues = false

      // targetHandle === ROOT_HANDLE_ID means the user dropped onto the root
      // input port (collapsed node). Auto-expand to per-field references when
      // the target's input schema is an object with known properties; fall back
      // to whole-object string form otherwise.
      const isRootTarget = targetHandle === ROOT_HANDLE_ID
      if (isRootTarget) {
        const targetSchema = schemas[targetNode.uses]?.inputs
        const targetFields =
          targetSchema?.type === "object" && targetSchema.properties
            ? Object.keys(targetSchema.properties)
            : null

        if (targetFields && targetFields.length > 0) {
          // Auto-expand: for each target field, create a per-field reference
          // extending the source path by that field name.
          const existing = targetNode.in
          if (existing && typeof existing === "object" && Object.keys(existing).length > 0) {
            if (!confirmed) {
              void confirmAction({
                title: `Replace ${target}'s input bindings?`,
                description: `Every input of ${target} will be connected field-by-field from ${refString}, replacing its current bindings.`,
                confirmLabel: "Replace bindings",
              }).then((ok) => {
                if (ok) connectRef.current(conn, true)
              })
              return
            }
          }
          const expanded: Record<string, string> = {}
          for (const field of targetFields) {
            expanded[field] = `${refString}.${field}`
            valuesToClear.add(field)
          }
          nextIn = expanded
        } else {
          // Target has no known schema (or schema isn't an object with properties)
          // — fall back to the whole-object string form.
          const existing = targetNode.in
          if (existing && typeof existing === "object" && Object.keys(existing).length > 0) {
            if (!confirmed) {
              void confirmAction({
                title: `Replace ${target}'s input bindings?`,
                description: `${target}'s per-field bindings will be replaced by the whole-object reference ${refString}.`,
                confirmLabel: "Replace bindings",
              }).then((ok) => {
                if (ok) connectRef.current(conn, true)
              })
              return
            }
          }
          nextIn = refString
          // Whole-object form replaces all per-field state — including any
          // literals the user had typed.
          dropAllValues = true
        }
      } else {
        // Per-field form. Convert string-form to object-form if needed.
        const base: Record<string, string> =
          typeof targetNode.in === "string" || !targetNode.in ? {} : { ...targetNode.in }
        base[targetHandle] = refString
        nextIn = base
        valuesToClear.add(targetHandle)
      }

      // Clear the corresponding literal values where references now take over.
      let nextValues: Record<string, unknown> | undefined = targetNode.values
      if (dropAllValues) {
        nextValues = undefined
      } else if (valuesToClear.size > 0 && targetNode.values) {
        const filtered: Record<string, unknown> = {}
        let removed = false
        for (const [k, v] of Object.entries(targetNode.values)) {
          if (valuesToClear.has(k)) {
            removed = true
            continue
          }
          filtered[k] = v
        }
        if (removed) {
          nextValues = Object.keys(filtered).length > 0 ? filtered : undefined
        }
      }

      const nextNode: typeof targetNode = { ...targetNode, in: nextIn }
      if (nextValues === undefined) {
        delete (nextNode as { values?: unknown }).values
      } else {
        nextNode.values = nextValues
      }

      const next: WorkflowFile = {
        ...wf,
        nodes: { ...wf.nodes, [target]: nextNode },
      }
      applyWorkflow(next)
    },
    [applyWorkflow, schemas],
  )
  const connectRef = useRef(connect)
  connectRef.current = connect
  const onConnect = useCallback((conn: Connection) => connect(conn), [connect])

  /**
   * An input's handle let go over empty canvas becomes a variable: typed from
   * that input's schema, placed where it was dropped and wired to the input.
   */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      const from = state.fromHandle
      if (state.isValid || state.toNode || !from || from.type !== "target") return
      if (from.id === WHEN_HANDLE_ID) return
      const wf = workflowRef.current
      const target = from.nodeId
      const node = wf?.nodes[target]
      if (!wf || !node || node.uses === VARIABLE_USES) return
      const portId = from.id === ROOT_HANDLE_ID ? "" : (from.id ?? "")
      // A whole-input variable would replace every binding the node has.
      const bound = typeof node.in === "string" || Object.keys(node.in ?? {}).length > 0
      if (portId === "" && bound) return
      const schema = schemaAtPath(schemas[node.uses]?.inputs, portId)
      const point = "changedTouches" in event ? event.changedTouches[0] : event
      if (!point) return
      const drop = screenToFlowPosition({ x: point.clientX, y: point.clientY })
      // Put the variable's output handle (top right) under the pointer.
      const width = variableKind(schema, undefined) === "json" ? 300 : 206
      const result = extractVariable(wf, {
        target,
        portId,
        schema,
        position: { x: Math.round(drop.x - width), y: Math.round(drop.y - 16) },
      })
      if (!result) return
      applyWorkflow(result.workflow)
      setSelected(result.id)
    },
    [applyWorkflow, schemas, screenToFlowPosition, setSelected],
  )

  // Live file events. Changes to this workflow flow into the draft: a clean
  // tab reloads (as an undoable step), a dirty tab keeps its edits and shows
  // a conflict notice. (Node source changes refresh schemas via useSchemas.)
  useEffect(() => {
    return subscribeToFileEvents((e) => {
      if (e.path !== path) return
      if (e.type === "unlink") {
        setDeletedOnDisk(true)
        return
      }
      setDeletedOnDisk(false)
      fetchWorkflowFile(path)
        .then((wf) => {
          if (!aliveRef.current) return
          setExternalError(null)
          useWorkflowDrafts.getState().externalChange(tabId, wf)
        })
        .catch((err: Error) => {
          if (aliveRef.current) setExternalError(err.message)
        })
    })
  }, [path, tabId])

  if (error && !workflow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-sm font-medium text-destructive">Error loading workflow</div>
        <div className="max-w-md break-words font-mono text-xs text-muted-foreground">{error}</div>
        <button
          type="button"
          onClick={() => loadFromDisk()}
          className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!workflow) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Loading {path}…
      </div>
    )
  }

  const saveStatus: SaveStatus =
    saveState === "saving" || saveState === "saved" || saveState === "error"
      ? saveState
      : dirty
        ? "dirty"
        : "clean"
  const isEmpty = Object.keys(workflow.nodes).length === 0

  return (
    <div className="flex h-full w-full flex-col">
      <CanvasToolbar
        path={path}
        status={saveStatus}
        canUndo={canUndo}
        canRedo={canRedo}
        diagnostics={diagnostics}
        onUndo={undo}
        onRedo={redo}
        onSave={() => void save()}
        onAddNode={() => setPaletteOpen(true)}
        onFitView={() => void fitView({ padding: 0.2, duration: 250 })}
        onTidy={tidy}
        onFocusNode={focusNode}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onFixProblems={() =>
          askAi(fixProblems({ workflowPath: path, workflow: workflowRef.current, diagnostics }))
        }
        onAskAi={askAboutWorkflow}
        selectedNodeId={selectedNodeId}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target for nodes dragged from the file tree */}
      <div className="relative min-h-0 w-full flex-1" onDragOver={onDragOver} onDrop={onDrop}>
        <div ref={reactFlowRef} className="h-full w-full">
          <ReactFlow
            nodes={nodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            connectionLineComponent={ConnectionLine}
            onNodesDelete={onNodesDelete}
            deleteKeyCode={DELETE_KEYS}
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
            colorMode={colorMode}
            snapToGrid={snapToGrid}
            snapGrid={[CANVAS_GRID, CANVAS_GRID]}
            nodesConnectable={true}
            proOptions={{ hideAttribution: true }}
          >
            {canvasBackground !== "none" && (
              <Background
                gap={CANVAS_GRID}
                size={canvasBackground === "dots" ? 1.2 : 1}
                variant={
                  canvasBackground === "dots" ? BackgroundVariant.Dots : BackgroundVariant.Lines
                }
                color="var(--canvas-dot)"
              />
            )}
            <Controls showFitView={false} />
            {!isEmpty && showMinimap && (
              <MiniMap
                pannable
                zoomable
                className="!rounded-lg !border !border-border !bg-card"
                nodeColor={minimapFill}
                nodeStrokeColor={minimapStroke}
                nodeStrokeWidth={2}
                nodeBorderRadius={4}
                maskColor="color-mix(in srgb, var(--background) 55%, transparent)"
              />
            )}
          </ReactFlow>
        </div>
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card/80 p-6 text-center shadow-sm">
              <div className="text-sm font-medium">This workflow is empty</div>
              <p className="text-xs text-muted-foreground">
                Start with an HTTP Request trigger, add the nodes that do the work, and finish with
                a Response. Right-click the canvas or press Ctrl+K to add nodes, or drag them in
                from the Files panel.
              </p>
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Add a node
              </button>
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col items-center gap-2">
          {diskConflict && (
            <EditorNotice
              tone="warning"
              title="This workflow changed on disk"
              actions={[
                {
                  label: "Reload from disk",
                  onClick: () => useWorkflowDrafts.getState().resolveConflict(tabId, "disk"),
                },
                {
                  label: "Keep my changes",
                  onClick: () => useWorkflowDrafts.getState().resolveConflict(tabId, "mine"),
                },
              ]}
            >
              You have unsaved edits. Reloading discards them (you can undo); keeping them
              overwrites the disk version on your next save.
            </EditorNotice>
          )}
          {deletedOnDisk && (
            <EditorNotice tone="warning" title="This workflow was deleted on disk">
              Save (Ctrl+S) to recreate it, or close the tab.
            </EditorNotice>
          )}
          {externalError && (
            <EditorNotice
              tone="error"
              title="Couldn't reload the file from disk"
              actions={[{ label: "Dismiss", onClick: () => setExternalError(null) }]}
            >
              {externalError}
            </EditorNotice>
          )}
          {schemasError && (
            <EditorNotice
              tone="warning"
              title="Node schemas unavailable"
              actions={[{ label: "Retry", onClick: reloadSchemas }]}
            >
              Ports are inferred from the workflow until schemas load. {schemasError}
            </EditorNotice>
          )}
          {saveState === "error" && (
            <EditorNotice
              tone="error"
              title="Save failed"
              actions={[
                { label: "Retry", onClick: () => void save() },
                { label: "Dismiss", onClick: () => setSaveState("idle") },
              ]}
            >
              {saveError ?? "The file could not be written."}
            </EditorNotice>
          )}
        </div>
        <CommandPalette
          schemas={schemas}
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onPick={(uses) => {
            const c = viewportCenter()
            addNodeAt(uses, c.x, c.y)
          }}
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
            reloadSchemas()
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
          onDuplicate={() => nodeMenu.nodeId && duplicate(nodeMenu.nodeId)}
          onReset={handleResetConnections}
          onToggleBreakpointBefore={handleToggleBreakpointBefore}
          onToggleBreakpointAfter={handleToggleBreakpointAfter}
          {...(nodeMenu.nodeId && workflow?.nodes[nodeMenu.nodeId]?.uses.startsWith(".")
            ? { onViewSource: handleViewSource, onGenerateCases: () => aiForNode("cases") }
            : {})}
          onExplain={() => aiForNode("explain")}
        />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      </div>
    </div>
  )
}

/** True when keyboard focus is somewhere text is typed (native undo applies). */
function isTextEntry(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLElement && el.isContentEditable) return true
  const tag = el.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

/** Breakpoint decorations for one node, as WorkflowNode's data expects them. */
function breakpointDataFor(
  breakpoints: readonly Breakpoint[],
  workflowPath: string,
  nodeId: string,
): { nodeBreakpoint: { before: boolean; after: boolean }; portBreakpoints: Set<string> } {
  const bps = breakpoints.filter((b) => b.workflowPath === workflowPath && b.nodeId === nodeId)
  return {
    nodeBreakpoint: {
      before: bps.some((b) => b.kind === "before"),
      after: bps.some((b) => b.kind === "after"),
    },
    portBreakpoints: new Set(
      bps.filter((b) => b.kind.startsWith("port:")).map((b) => b.kind.slice("port:".length)),
    ),
  }
}

function autoPosition(i: number): { x: number; y: number } {
  return { x: (i % 4) * 220 + 40, y: Math.floor(i / 4) * 140 + 40 }
}

/**
 * Back-compat alias — moved to `./template`. Re-exported here so existing
 * importers keep working until they migrate to importing from "./template"
 * directly.
 */
export { deriveWorkflowPath as defaultPathForWorkflow } from "./template"

/** A condition edge's label when it leaves a branch: "= cat", "not default". */
function branchLabelFor(wf: WorkflowFile, c: Condition): string | null {
  const label = branchLabel(wf, c.nodeId, c.path)
  return label === null ? null : c.negate ? `not ${label}` : label
}
