import {
  Background,
  Controls,
  type Edge,
  type NodeTypes,
  ReactFlow,
  type Node as RFNode,
} from "@xyflow/react"
import { useEffect, useMemo, useState } from "react"
import "@xyflow/react/dist/style.css"
import { fetchWorkflowFile, type WorkflowFile } from "@/lib/api"
import { useThemeStore } from "@/store/theme"
import { extractReferences } from "./parse-references"
import { WorkflowNode } from "./workflow-node"

interface Props {
  /** API path like "workflows/users/create.workflow" */
  path: string
}

// Cast to NodeTypes to avoid the strict generic constraint mismatch.
// WorkflowNode accepts { data: Record<string, unknown> } which is compatible
// at runtime with what React Flow passes, but TypeScript's strict generics
// can't verify that without the full Node extension. The cast is safe.
const nodeTypes: NodeTypes = { workflow: WorkflowNode as NodeTypes[string] }

export function WorkflowEditor({ path }: Props) {
  const [workflow, setWorkflow] = useState<WorkflowFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const theme = useThemeStore((s) => s.theme)

  useEffect(() => {
    let alive = true
    setError(null)
    setWorkflow(null)
    fetchWorkflowFile(path)
      .then((wf) => {
        if (alive) setWorkflow(wf)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [path])

  const { nodes, edges } = useMemo<{ nodes: RFNode[]; edges: Edge[] }>(() => {
    if (!workflow) return { nodes: [], edges: [] }

    const wfNodes: RFNode[] = Object.entries(workflow.nodes).map(([id, instance], i) => {
      const view = workflow.view?.[id]
      return {
        id,
        type: "workflow",
        position: view ?? autoPosition(i),
        data: { id, instance },
      }
    })

    const refs = extractReferences(workflow)
    const wfEdges: Edge[] = refs.map((r, i) => ({
      id: `e-${i}`,
      source: r.from.nodeId,
      target: r.to.nodeId,
      label: r.from.path.length > 0 ? `${r.from.path.join(".")} → ${r.to.field}` : r.to.field,
      animated: false,
    }))

    return { nodes: wfNodes, edges: wfEdges }
  }, [workflow])

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
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        colorMode={theme}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
        <Controls />
      </ReactFlow>
    </div>
  )
}

function autoPosition(i: number): { x: number; y: number } {
  return { x: (i % 4) * 220 + 40, y: Math.floor(i / 4) * 140 + 40 }
}
