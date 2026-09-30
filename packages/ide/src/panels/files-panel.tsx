import {
  ChevronDown,
  ChevronRight,
  FileCode,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  WifiOff,
  Workflow,
} from "lucide-react"
import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { type FileFolder, type FileNode, mockNodes, mockWorkflows } from "@/data/mock-files"
import { fetchWorkspaceTree } from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"
import { openCodeFile } from "@/lib/open-code-file"
import { cn } from "@/lib/utils"
import { deleteItem, type WorkspaceItem } from "@/lib/workspace-items"
import { useCommands } from "@/store/commands"
import { useDockviewApi } from "@/store/dockview-api"
import { caseSummary, useNodeCases } from "@/store/node-cases"
import { useTabsStore } from "@/store/tabs"
import { NewFolderDialog } from "@/workflow/new-folder-dialog"
import { NewNodeDialog } from "@/workflow/new-node-dialog"
import { NewWorkflowDialog } from "@/workflow/new-workflow-dialog"
import { RenameItemDialog } from "@/workflow/rename-item-dialog"
import { TreeContextMenu } from "./tree-context-menu"

type LoadState = "loading" | "ready" | "fallback"
type TreeKind = "workflows" | "nodes"

function sortChildren(children: readonly FileNode[]): FileNode[] {
  return [...children].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

interface MenuState {
  open: boolean
  x: number
  y: number
  tree: TreeKind
  folder: string
  /** The workflow or node file right-clicked, if any. */
  item?: WorkspaceItem | undefined
}

type DialogKind = "none" | "new-folder" | "new-workflow" | "new-node"

export function FilesPanel() {
  const [workflows, setWorkflows] = useState<FileFolder>(mockWorkflows)
  const [nodes, setNodes] = useState<FileFolder>(mockNodes)
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [menu, setMenu] = useState<MenuState>({
    open: false,
    x: 0,
    y: 0,
    tree: "workflows",
    folder: "workflows",
  })
  const [dialog, setDialog] = useState<DialogKind>("none")
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refreshTree = () => {
    fetchWorkspaceTree()
      .then((tree) => {
        if (!mountedRef.current) return
        setWorkflows(tree.workflows)
        setNodes(tree.nodes)
        setLoadState("ready")
      })
      .catch(() => {
        if (!mountedRef.current) return
        setLoadState("fallback")
      })
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load the tree once on mount
  useEffect(() => {
    refreshTree()
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: subscribe once; refreshTree reads refs and is safe to capture
  useEffect(() => {
    return subscribeToFileEvents((e) => {
      if (e.type === "add" || e.type === "unlink") {
        refreshTree()
      }
    })
  }, [])

  const openMenu = (e: ReactMouseEvent, tree: TreeKind, folder: string, item?: WorkspaceItem) => {
    if (loadState !== "ready") return
    e.preventDefault()
    e.stopPropagation()
    setMenu({ open: true, x: e.clientX, y: e.clientY, tree, folder, item })
  }
  const [renaming, setRenaming] = useState<WorkspaceItem | null>(null)
  const [itemError, setItemError] = useState<string | null>(null)

  const itemTree = menu.tree === "workflows" ? workflows : nodes

  // Opens a create dialog aimed at a tree's root folder (header buttons, File menu).
  const openRootDialog = (tree: TreeKind, kind: Exclude<DialogKind, "none">) => {
    const root = tree === "workflows" ? workflows : nodes
    setMenu((m) => ({ ...m, open: false, tree, folder: root.name || tree }))
    setDialog(kind)
  }
  const openRootDialogRef = useRef(openRootDialog)
  openRootDialogRef.current = openRootDialog

  const ready = loadState === "ready"
  useEffect(
    () =>
      useCommands.getState().register({
        "file.newWorkflow": {
          run: () => openRootDialogRef.current("workflows", "new-workflow"),
          enabled: ready,
        },
        "file.newNode": {
          run: () => openRootDialogRef.current("nodes", "new-node"),
          enabled: ready,
        },
        "file.newFolder": {
          run: () => openRootDialogRef.current("workflows", "new-folder"),
          enabled: ready,
        },
      }),
    [ready],
  )

  return (
    <div className="flex h-full flex-col" data-testid="files-panel">
      {loadState === "fallback" && (
        <div className="flex items-center gap-1.5 border-b bg-warning/10 px-2 py-1 text-[10px] text-warning">
          <WifiOff className="h-3 w-3 shrink-0" />
          <span>Backend not available — showing demo data</span>
        </div>
      )}
      {itemError && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b bg-destructive/10 px-2 py-1 text-[11px] text-destructive"
        >
          <span className="min-w-0 flex-1">{itemError}</span>
          <button type="button" onClick={() => setItemError(null)} className="hover:underline">
            Dismiss
          </button>
        </div>
      )}
      <ScrollArea className="flex-1">
        <div className="p-2 h-full">
          {loadState === "loading" ? (
            <div className="space-y-1 px-1 py-2">
              <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <>
              <Section
                title="WORKFLOWS"
                treeKind="workflows"
                tree={workflows}
                onContextMenu={openMenu}
                autoExpand={loadState === "ready"}
                {...(ready && {
                  onNewItem: () => openRootDialog("workflows", "new-workflow"),
                  onNewFolder: () => openRootDialog("workflows", "new-folder"),
                })}
              />
              <Section
                title="NODES"
                treeKind="nodes"
                tree={nodes}
                onContextMenu={openMenu}
                autoExpand={loadState === "ready"}
                {...(ready && {
                  onNewItem: () => openRootDialog("nodes", "new-node"),
                  onNewFolder: () => openRootDialog("nodes", "new-folder"),
                })}
              />
            </>
          )}
        </div>
      </ScrollArea>
      <TreeContextMenu
        open={menu.open}
        onOpenChange={(o) => setMenu((m) => ({ ...m, open: o }))}
        x={menu.x}
        y={menu.y}
        tree={menu.tree}
        onNewFolder={() => setDialog("new-folder")}
        onNewItem={() => setDialog(menu.tree === "workflows" ? "new-workflow" : "new-node")}
        item={menu.item && { name: menu.item.path.split("/").pop() ?? menu.item.path }}
        onRename={() => setRenaming(menu.item ?? null)}
        onDelete={() => {
          const item = menu.item
          if (!item) return
          setItemError(null)
          deleteItem(item).catch((e: Error) => setItemError(e.message))
        }}
      />
      <RenameItemDialog item={renaming} onOpenChange={(o) => !o && setRenaming(null)} />
      <NewFolderDialog
        open={dialog === "new-folder"}
        onOpenChange={(o) => !o && setDialog("none")}
        onCreated={() => refreshTree()}
        defaultFolder={menu.folder}
        root={itemTree}
      />
      <NewWorkflowDialog
        open={dialog === "new-workflow"}
        onOpenChange={(o) => !o && setDialog("none")}
        onCreated={(path) => {
          // refreshTree() is triggered by SSE add event; also open the new file
          const title = path.split("/").pop() ?? path
          useTabsStore.getState().openTab({ id: path, title, kind: "workflow", path })
          useDockviewApi.getState().api?.getPanel("editor")?.api.setActive()
        }}
        defaultFolder={menu.folder}
        workflowsTree={workflows}
      />
      <NewNodeDialog
        open={dialog === "new-node"}
        onOpenChange={(o) => !o && setDialog("none")}
        onCreated={(uses) => {
          // uses is "./nodes/foo" — convert back to file path for the tab
          const path = `${uses.replace(/^\.\//, "")}.ts`
          openCodeFile(path)
        }}
        defaultFolder={menu.folder}
        nodesTree={nodes}
      />
    </div>
  )
}

function Section({
  title,
  treeKind,
  tree,
  onContextMenu,
  autoExpand = false,
  onNewItem,
  onNewFolder,
}: {
  title: string
  treeKind: TreeKind
  tree: FileNode
  onContextMenu: (e: ReactMouseEvent, tree: TreeKind, folder: string, item?: WorkspaceItem) => void
  autoExpand?: boolean
  onNewItem?: () => void
  onNewFolder?: () => void
}) {
  const rootPath = tree.type === "folder" ? tree.name : treeKind
  // Render children of the root folder directly (the section header IS the root label).
  // This avoids a redundant "workflows"/"nodes" folder button in the tree that would
  // conflict with dialog folder labels in tests and in the UI.
  const children = tree.type === "folder" ? sortChildren(tree.children) : []
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click anywhere in the section opens its menu; entries are buttons
    <div className="mb-3" onContextMenu={(e) => onContextMenu(e, treeKind, rootPath)}>
      <div className="group/section flex h-7 items-center gap-1 px-1 text-[11px] font-semibold tracking-wider text-muted-foreground">
        <span className="flex-1">{title}</span>
        {onNewItem && (
          <SectionAction
            label={treeKind === "workflows" ? "New workflow" : "New node"}
            onClick={onNewItem}
          >
            <Plus className="h-3.5 w-3.5" />
          </SectionAction>
        )}
        {onNewFolder && (
          <SectionAction label={`New folder in ${treeKind}`} onClick={onNewFolder}>
            <FolderPlus className="h-3.5 w-3.5" />
          </SectionAction>
        )}
      </div>
      {children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={0}
          path={child.type === "folder" ? `${rootPath}/${child.name}` : rootPath}
          treeKind={treeKind}
          onContextMenu={onContextMenu}
          autoExpand={autoExpand}
        />
      ))}
    </div>
  )
}

function SectionAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 group-hover/section:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
    >
      {children}
    </button>
  )
}

function TreeNode({
  node,
  depth,
  path,
  treeKind,
  onContextMenu,
  autoExpand = false,
}: {
  node: FileNode
  depth: number
  path: string
  treeKind: TreeKind
  onContextMenu: (e: ReactMouseEvent, tree: TreeKind, folder: string, item?: WorkspaceItem) => void
  autoExpand?: boolean
}) {
  if (node.type === "folder") {
    return (
      <Folder_
        node={node}
        depth={depth}
        path={path}
        treeKind={treeKind}
        onContextMenu={onContextMenu}
        autoExpand={autoExpand}
      />
    )
  }
  return (
    <Leaf
      node={node}
      depth={depth}
      parentPath={path}
      treeKind={treeKind}
      onContextMenu={onContextMenu}
    />
  )
}

function Folder_({
  node,
  depth,
  path,
  treeKind,
  onContextMenu,
  autoExpand,
}: {
  node: Extract<FileNode, { type: "folder" }>
  depth: number
  path: string
  treeKind: TreeKind
  onContextMenu: (e: ReactMouseEvent, tree: TreeKind, folder: string, item?: WorkspaceItem) => void
  autoExpand?: boolean
}) {
  // depth-0 folders (direct children of the section root) start open when autoExpand is on.
  const [open, setOpen] = useState((autoExpand ?? false) && depth === 0)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => onContextMenu(e, treeKind, path)}
        className={cn(
          "flex h-[26px] w-full items-center gap-1.5 rounded-md px-1 text-left text-[13px] text-foreground/85 hover:bg-accent hover:text-accent-foreground",
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        {open ? (
          <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <Folder className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <div>
          {sortChildren(node.children).map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              path={child.type === "folder" ? `${path}/${child.name}` : path}
              treeKind={treeKind}
              onContextMenu={onContextMenu}
              autoExpand={autoExpand ?? false}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Leaf({
  node,
  depth,
  parentPath,
  treeKind,
  onContextMenu,
}: {
  node: Extract<FileNode, { type: "file" }>
  depth: number
  parentPath: string
  treeKind: TreeKind
  onContextMenu: (e: ReactMouseEvent, tree: TreeKind, folder: string, item?: WorkspaceItem) => void
}) {
  const openTab = useTabsStore((s) => s.openTab)
  const activeId = useTabsStore((s) => s.activeId)
  const tabId = node.kind === "node" ? (node.path ?? node.id) : node.id
  const isActive = activeId === tabId

  const Icon = node.kind === "workflow" ? Workflow : FileCode

  return (
    <button
      type="button"
      draggable={node.kind === "node" && node.path?.endsWith(".ts")}
      onDragStart={(e) => {
        if (node.path?.endsWith(".ts")) {
          const uses = `./${node.path.replace(/\.ts$/, "")}`
          e.dataTransfer.setData("application/lorien-node", uses)
          e.dataTransfer.effectAllowed = "copy"
        }
      }}
      onContextMenu={(e) => {
        // Target = the file's parent folder. Derive from node.path when available
        // (most accurate); fall back to parentPath threaded through TreeNode.
        const folder = node.path
          ? node.path.split("/").slice(0, -1).join("/") || parentPath
          : parentPath
        const item: WorkspaceItem | undefined =
          node.path && (node.kind === "workflow" || node.kind === "node")
            ? { path: node.path, kind: node.kind }
            : undefined
        onContextMenu(e, treeKind, folder, item)
      }}
      onClick={() => {
        if (node.kind === "node" && node.path) {
          openCodeFile(node.path)
          return
        }
        const tab: Parameters<typeof openTab>[0] = {
          id: node.id,
          title: node.name,
          kind: node.kind,
        }
        if (node.path !== undefined) tab.path = node.path
        openTab(tab)

        const api = useDockviewApi.getState().api
        if (api) {
          api.getPanel("editor")?.api.setActive()
        }
      }}
      className={cn(
        "flex h-[26px] w-full items-center gap-2 rounded-md px-1 text-left text-[13px] text-foreground/85 hover:bg-accent hover:text-accent-foreground",
        isActive && "bg-primary/12 font-medium text-foreground hover:bg-primary/15",
      )}
      style={{ paddingLeft: depth * 12 + 16 }}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          node.kind === "workflow" ? "text-primary" : "text-info",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {node.kind === "node" && node.path && <NodeTestCount nodeFile={node.path} />}
    </button>
  )
}

/** Passing cases next to a node file, once its cases have run. */
function NodeTestCount({ nodeFile }: { nodeFile: string }) {
  // Select a string: a fresh summary object each time would re-render forever.
  const key = useNodeCases((s) => {
    const sum = caseSummary(s, nodeFile)
    return sum ? `${sum.passed}/${sum.failed}/${sum.run}` : ""
  })
  if (!key) return null
  const [passed = 0, failed = 0, run = 0] = key.split("/").map(Number)
  const sum = { passed, failed, run }
  if (sum.run === 0) return null
  const ok = sum.failed === 0
  const label = ok
    ? `${sum.passed} of ${sum.run} tests passing`
    : `${sum.failed} of ${sum.run} tests failing`
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "mr-1 shrink-0 font-mono text-[10.5px]",
        ok ? "text-success" : "text-destructive",
      )}
    >
      {ok ? `${sum.passed}/${sum.run}` : `${sum.failed} ✕`}
    </span>
  )
}
