import {
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type Edge,
  type NodeChange,
  type NodeTypes,
  ReactFlow,
  type Node as RFNode,
} from "@xyflow/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import "@xyflow/react/dist/style.css"
import {
  fetchWorkflowFile,
  fetchWorkspaceSchemas,
  type NodeSchemas,
  saveFile,
  type WorkflowFile,
} from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"
import { useTabsStore } from "@/store/tabs"
import { useThemeStore } from "@/store/theme"
import { derivePorts } from "./derive-ports"
import { extractReferences } from "./parse-references"
import { WorkflowNode } from "./workflow-node"

interface Props {
  /** API path like "workflows/users/create.workflow" */
  path: string
  /** Tab ID so we can update dirty state in the store. */
  tabId: string
}

// Cast to NodeTypes to avoid the strict generic constraint mismatch.
// WorkflowNode accepts { data: Record<string, unknown> } which is compatible
// at runtime with what React Flow passes, but TypeScript's strict generics
// can't verify that without the full Node extension. The cast is safe.
const nodeTypes: NodeTypes = { workflow: WorkflowNode as NodeTypes[string] }

type SaveState = "idle" | "saving" | "saved" | "error"

export function WorkflowEditor({ path, tabId }: Props) {
  const [workflow, setWorkflow] = useState<WorkflowFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<RFNode[]>([])
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [dirty, setLocalDirty] = useState(false)
  const [schemas, setSchemas] = useState<Record<string, NodeSchemas>>({})
  const theme = useThemeStore((s) => s.theme)
  const setDirty = useTabsStore((s) => s.setDirty)

  // Always-current ref so persist callbacks don't close over stale nodes
  const nodesRef = useRef<RFNode[]>([])
  const workflowRef = useRef<WorkflowFile | null>(null)
  // Track dirty in a ref too so the Ctrl+S handler always sees fresh value
  const dirtyRef = useRef(false)

  const markDirty = useCallback(
    (value: boolean) => {
      setLocalDirty(value)
      dirtyRef.current = value
      setDirty(tabId, value)
    },
    [tabId, setDirty],
  )

  const doFetch = useCallback(() => {
    let alive = true
    setError(null)
    setWorkflow(null)
    setNodes([])
    markDirty(false)
    fetchWorkflowFile(path)
      .then((wf) => {
        if (alive) {
          setWorkflow(wf)
          workflowRef.current = wf
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [path, markDirty])

  useEffect(() => {
    return doFetch()
  }, [doFetch])

  // Fetch schemas once on mount — they don't change per workflow tab
  useEffect(() => {
    let alive = true
    fetchWorkspaceSchemas()
      .then((s) => {
        if (alive) setSchemas(s)
      })
      .catch(() => {
        // Schemas are best-effort; fall back to inference if the call fails
        if (alive) setSchemas({})
      })
    return () => {
      alive = false
    }
  }, [])

  // Initialise nodes whenever workflow OR schemas change
  useEffect(() => {
    if (!workflow) return
    const portsByNode = derivePorts(workflow, schemas)
    const initial: RFNode[] = Object.entries(workflow.nodes).map(([id, instance], i) => {
      const view = workflow.view?.[id]
      return {
        id,
        type: "workflow",
        position: view ?? autoPosition(i),
        data: { id, instance, ports: portsByNode.get(id) ?? { inputs: [], outputs: [] } },
      }
    })
    setNodes(initial)
    nodesRef.current = initial
  }, [workflow, schemas])

  const edges = useMemo<Edge[]>(() => {
    if (!workflow) return []
    const refs = extractReferences(workflow)
    return refs.map((r, i) => ({
      id: `e-${i}`,
      source: r.source.nodeId,
      sourceHandle: r.source.portId,
      target: r.target.nodeId,
      targetHandle: r.target.portId,
      label: r.source.remainingPath.length > 0 ? r.source.remainingPath.join(".") : undefined,
      type: "default",
      animated: false,
    }))
  }, [workflow])

  const save = useCallback(async () => {
    const wf = workflowRef.current
    if (!wf) return
    setSaveState("saving")
    const newView: Record<string, { x: number; y: number }> = {}
    for (const n of nodesRef.current) {
      newView[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
    }
    const updated: WorkflowFile = { ...wf, view: newView }
    try {
      await saveFile(path, `${JSON.stringify(updated, null, 2)}\n`)
      // Update the in-memory workflow so subsequent saves start from the new state
      workflowRef.current = updated
      markDirty(false)
      setSaveState("saved")
      setTimeout(() => setSaveState("idle"), 1500)
    } catch (e) {
      console.error("Failed to persist workflow positions:", e)
      setSaveState("error")
    }
  }, [path, markDirty])

  // Ctrl+S / Cmd+S — global listener (fine in v1; scope to div if needed later)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [save])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Eagerly compute and store the next nodes in the ref so the Ctrl+S
      // handler always sees the latest positions.
      const next = applyNodeChanges(changes, nodesRef.current)
      nodesRef.current = next
      setNodes(next)

      // When any drag ends, mark the tab dirty (no autosave)
      const dragEnded = changes.some((c) => c.type === "position" && c.dragging === false)
      if (dragEnded) {
        markDirty(true)
      }
    },
    [markDirty],
  )

  /**
   * Drag-to-connect: when the user drags from a source handle to a target
   * handle, update the target node's `in:` block with the reference string
   * `sourceNodeId.sourcePath` and mark the tab dirty. Ctrl+S persists.
   */
  const onConnect = useCallback(
    (conn: Connection) => {
      const { source, sourceHandle, target, targetHandle } = conn
      if (!source || !target || !sourceHandle || !targetHandle) return
      const refString = `${source}.${sourceHandle}`
      setWorkflow((wf) => {
        if (!wf) return wf
        const targetNode = wf.nodes[target]
        if (!targetNode) return wf
        const inBlock = { ...(targetNode.in ?? {}) }
        inBlock[targetHandle] = refString
        const next: WorkflowFile = {
          ...wf,
          nodes: { ...wf.nodes, [target]: { ...targetNode, in: inBlock } },
        }
        workflowRef.current = next
        return next
      })
      markDirty(true)
    },
    [markDirty],
  )

  // Subscribe to live file events — reload if the file changes externally,
  // but only when this tab doesn't have unsaved drags (don't clobber local work).
  useEffect(() => {
    return subscribeToFileEvents((e) => {
      if (e.path !== path) return
      if (dirtyRef.current) return // keep local state
      doFetch()
    })
  }, [path, doFetch])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
        Error loading workflow: {error}
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

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        fitView
        colorMode={theme}
        nodesConnectable={true}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
        <Controls />
      </ReactFlow>
      {saveState !== "idle" && (
        <div
          className={
            saveState === "error"
              ? "absolute bottom-3 right-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs text-destructive"
              : "absolute bottom-3 right-3 rounded-md border border-border bg-card px-3 py-1 text-xs text-muted-foreground"
          }
        >
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save failed"}
        </div>
      )}
      {dirty && saveState === "idle" && (
        <div className="absolute bottom-3 left-3 rounded-md border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          Unsaved changes — Ctrl+S to save
        </div>
      )}
    </div>
  )
}

function autoPosition(i: number): { x: number; y: number } {
  return { x: (i % 4) * 220 + 40, y: Math.floor(i / 4) * 140 + 40 }
}
