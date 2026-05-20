import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  WifiOff,
} from "lucide-react"
import { useEffect, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { type FileFolder, type FileNode, mockNodes, mockWorkflows } from "@/data/mock-files"
import { fetchWorkspaceTree } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useDockviewApi } from "@/store/dockview-api"
import { useTabsStore } from "@/store/tabs"

type LoadState = "loading" | "ready" | "fallback"

export function FilesPanel() {
  const [workflows, setWorkflows] = useState<FileFolder>(mockWorkflows)
  const [nodes, setNodes] = useState<FileFolder>(mockNodes)
  const [loadState, setLoadState] = useState<LoadState>("loading")

  useEffect(() => {
    let cancelled = false
    fetchWorkspaceTree()
      .then((tree) => {
        if (cancelled) return
        setWorkflows(tree.workflows)
        setNodes(tree.nodes)
        setLoadState("ready")
      })
      .catch(() => {
        if (cancelled) return
        setLoadState("fallback")
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      {loadState === "fallback" && (
        <div className="flex items-center gap-1.5 border-b bg-amber-500/10 px-2 py-1 text-[10px] text-amber-600 dark:text-amber-400">
          <WifiOff className="h-3 w-3 shrink-0" />
          <span>Backend not available — showing demo data</span>
        </div>
      )}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {loadState === "loading" ? (
            <div className="space-y-1 px-1 py-2">
              <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <>
              <Section title="WORKFLOWS" tree={workflows} />
              <Section title="NODES" tree={nodes} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function Section({ title, tree }: { title: string; tree: FileNode }) {
  return (
    <div className="mb-3">
      <div className="px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <TreeNode node={tree} depth={0} forceOpen />
    </div>
  )
}

function TreeNode({
  node,
  depth,
  forceOpen = false,
}: {
  node: FileNode
  depth: number
  forceOpen?: boolean
}) {
  if (node.type === "folder") {
    return <Folder_ node={node} depth={depth} forceOpen={forceOpen} />
  }
  return <Leaf node={node} depth={depth} />
}

function Folder_({
  node,
  depth,
  forceOpen,
}: {
  node: Extract<FileNode, { type: "folder" }>
  depth: number
  forceOpen: boolean
}) {
  const [open, setOpen] = useState(forceOpen)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
        )}
        style={{ paddingLeft: depth * 8 + 4 }}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {open ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function Leaf({ node, depth }: { node: Extract<FileNode, { type: "file" }>; depth: number }) {
  const openTab = useTabsStore((s) => s.openTab)
  const activeWorkflowId = useTabsStore((s) => s.activeWorkflowId)
  const activeCodeId = useTabsStore((s) => s.activeCodeId)
  const isActive =
    node.kind === "workflow" ? activeWorkflowId === node.id : activeCodeId === node.id

  const Icon = node.kind === "workflow" ? FileText : FileCode

  return (
    <button
      type="button"
      onClick={() => {
        const tab: Parameters<typeof openTab>[0] = {
          id: node.id,
          title: node.name,
          kind: node.kind,
        }
        if (node.path !== undefined) tab.path = node.path
        openTab(tab)

        // Focus the corresponding dockview panel so the user sees the right area
        const api = useDockviewApi.getState().api
        if (api) {
          const panelId = node.kind === "workflow" ? "workflow" : "code"
          const panel = api.getPanel(panelId)
          if (panel) panel.api.setActive()
        }
      }}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
        isActive && "bg-accent text-accent-foreground",
      )}
      style={{ paddingLeft: depth * 8 + 16 }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  )
}
