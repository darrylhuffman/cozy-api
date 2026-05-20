import { ChevronDown, ChevronRight, FileCode, FileText, Folder, FolderOpen } from "lucide-react"
import { useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { type FileNode, mockNodes, mockWorkflows } from "@/data/mock-files"
import { cn } from "@/lib/utils"
import { useTabsStore } from "@/store/tabs"

export function FilesPanel() {
  return (
    <ScrollArea className="h-full w-full">
      <div className="p-2">
        <Section title="WORKFLOWS" tree={mockWorkflows} />
        <Section title="NODES" tree={mockNodes} />
      </div>
    </ScrollArea>
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
  const activeId = useTabsStore((s) => s.activeId)
  const isActive = activeId === node.id

  const Icon = node.kind === "workflow" ? FileText : FileCode

  return (
    <button
      type="button"
      onClick={() => openTab({ id: node.id, title: node.name, kind: node.kind })}
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
