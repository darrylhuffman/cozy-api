import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  WifiOff,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type FileFolder,
  type FileNode,
  mockNodes,
  mockWorkflows,
} from "@/data/mock-files";
import { fetchWorkspaceTree } from "@/lib/api";
import { subscribeToFileEvents } from "@/lib/events";
import { openCodeFile } from "@/lib/open-code-file";
import { cn } from "@/lib/utils";
import { useDockviewApi } from "@/store/dockview-api";
import { useTabsStore } from "@/store/tabs";
import { NewFolderDialog } from "@/workflow/new-folder-dialog";
import { NewNodeDialog } from "@/workflow/new-node-dialog";
import { NewWorkflowDialog } from "@/workflow/new-workflow-dialog";
import { TreeContextMenu } from "./tree-context-menu";

type LoadState = "loading" | "ready" | "fallback";
type TreeKind = "workflows" | "nodes";

function sortChildren(children: readonly FileNode[]): FileNode[] {
  return [...children].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  tree: TreeKind;
  folder: string;
}

type DialogKind = "none" | "new-folder" | "new-workflow" | "new-node";

export function FilesPanel() {
  const [workflows, setWorkflows] = useState<FileFolder>(mockWorkflows);
  const [nodes, setNodes] = useState<FileFolder>(mockNodes);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [menu, setMenu] = useState<MenuState>({
    open: false,
    x: 0,
    y: 0,
    tree: "workflows",
    folder: "workflows",
  });
  const [dialog, setDialog] = useState<DialogKind>("none");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshTree = () => {
    fetchWorkspaceTree()
      .then((tree) => {
        if (!mountedRef.current) return;
        setWorkflows(tree.workflows);
        setNodes(tree.nodes);
        setLoadState("ready");
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setLoadState("fallback");
      });
  };

  useEffect(() => {
    refreshTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return subscribeToFileEvents((e) => {
      if (e.type === "add" || e.type === "unlink") {
        refreshTree();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openMenu = (e: ReactMouseEvent, tree: TreeKind, folder: string) => {
    if (loadState !== "ready") return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ open: true, x: e.clientX, y: e.clientY, tree, folder });
  };

  const itemTree = menu.tree === "workflows" ? workflows : nodes;

  return (
    <div className="flex h-full flex-col">
      {loadState === "fallback" && (
        <div className="flex items-center gap-1.5 border-b bg-amber-500/10 px-2 py-1 text-[10px] text-amber-600 dark:text-amber-400">
          <WifiOff className="h-3 w-3 shrink-0" />
          <span>Backend not available — showing demo data</span>
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
              />
              <Section
                title="NODES"
                treeKind="nodes"
                tree={nodes}
                onContextMenu={openMenu}
                autoExpand={loadState === "ready"}
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
        onNewItem={() =>
          setDialog(menu.tree === "workflows" ? "new-workflow" : "new-node")
        }
      />
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
          const title = path.split("/").pop() ?? path;
          useTabsStore
            .getState()
            .openTab({ id: path, title, kind: "workflow", path });
          useDockviewApi.getState().api?.getPanel("workflow")?.api.setActive();
        }}
        defaultFolder={menu.folder}
        workflowsTree={workflows}
      />
      <NewNodeDialog
        open={dialog === "new-node"}
        onOpenChange={(o) => !o && setDialog("none")}
        onCreated={(uses) => {
          // uses is "./nodes/foo" — convert back to file path for the tab
          const path = `${uses.replace(/^\.\//, "")}.ts`;
          openCodeFile(path);
        }}
        defaultFolder={menu.folder}
        nodesTree={nodes}
      />
    </div>
  );
}

function Section({
  title,
  treeKind,
  tree,
  onContextMenu,
  autoExpand = false,
}: {
  title: string;
  treeKind: TreeKind;
  tree: FileNode;
  onContextMenu: (e: ReactMouseEvent, tree: TreeKind, folder: string) => void;
  autoExpand?: boolean;
}) {
  const rootPath = tree.type === "folder" ? tree.name : treeKind;
  // Render children of the root folder directly (the section header IS the root label).
  // This avoids a redundant "workflows"/"nodes" folder button in the tree that would
  // conflict with dialog folder labels in tests and in the UI.
  const children = tree.type === "folder" ? sortChildren(tree.children) : [];
  return (
    <div
      className="mb-3"
      onContextMenu={(e) => onContextMenu(e, treeKind, rootPath)}
    >
      <div className="px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={0}
          path={
            child.type === "folder" ? `${rootPath}/${child.name}` : rootPath
          }
          treeKind={treeKind}
          onContextMenu={onContextMenu}
          autoExpand={autoExpand}
        />
      ))}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  path,
  treeKind,
  onContextMenu,
  autoExpand = false,
}: {
  node: FileNode;
  depth: number;
  path: string;
  treeKind: TreeKind;
  onContextMenu: (e: ReactMouseEvent, tree: TreeKind, folder: string) => void;
  autoExpand?: boolean;
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
    );
  }
  return (
    <Leaf
      node={node}
      depth={depth}
      parentPath={path}
      treeKind={treeKind}
      onContextMenu={onContextMenu}
    />
  );
}

function Folder_({
  node,
  depth,
  path,
  treeKind,
  onContextMenu,
  autoExpand,
}: {
  node: Extract<FileNode, { type: "folder" }>;
  depth: number;
  path: string;
  treeKind: TreeKind;
  onContextMenu: (e: ReactMouseEvent, tree: TreeKind, folder: string) => void;
  autoExpand?: boolean;
}) {
  // depth-0 folders (direct children of the section root) start open when autoExpand is on.
  const [open, setOpen] = useState((autoExpand ?? false) && depth === 0);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => onContextMenu(e, treeKind, path)}
        className={cn(
          "flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
        )}
        style={{ paddingLeft: depth * 8 + 4 }}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {open ? (
          <FolderOpen className="h-3.5 w-3.5" />
        ) : (
          <Folder className="h-3.5 w-3.5" />
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
  );
}

function Leaf({
  node,
  depth,
  parentPath,
  treeKind,
  onContextMenu,
}: {
  node: Extract<FileNode, { type: "file" }>;
  depth: number;
  parentPath: string;
  treeKind: TreeKind;
  onContextMenu: (e: ReactMouseEvent, tree: TreeKind, folder: string) => void;
}) {
  const openTab = useTabsStore((s) => s.openTab);
  const activeWorkflowId = useTabsStore((s) => s.activeWorkflowId);
  const activeCodeId = useTabsStore((s) => s.activeCodeId);
  const nodeTabId = node.kind === "node" ? (node.path ?? node.id) : node.id;
  const isActive =
    node.kind === "workflow"
      ? activeWorkflowId === node.id
      : activeCodeId === nodeTabId;

  const Icon = node.kind === "workflow" ? FileText : FileCode;

  return (
    <button
      type="button"
      draggable={node.kind === "node" && node.path?.endsWith(".ts")}
      onDragStart={(e) => {
        if (node.path && node.path.endsWith(".ts")) {
          const uses = `./${node.path.replace(/\.ts$/, "")}`;
          e.dataTransfer.setData("application/lorien-node", uses);
          e.dataTransfer.effectAllowed = "copy";
        }
      }}
      onContextMenu={(e) => {
        // Target = the file's parent folder. Derive from node.path when available
        // (most accurate); fall back to parentPath threaded through TreeNode.
        const folder = node.path
          ? node.path.split("/").slice(0, -1).join("/") || parentPath
          : parentPath;
        onContextMenu(e, treeKind, folder);
      }}
      onClick={() => {
        if (node.kind === "node" && node.path) {
          openCodeFile(node.path);
          return;
        }
        const tab: Parameters<typeof openTab>[0] = {
          id: node.id,
          title: node.name,
          kind: node.kind,
        };
        if (node.path !== undefined) tab.path = node.path;
        openTab(tab);

        const api = useDockviewApi.getState().api;
        if (api) {
          const panelId = node.kind === "workflow" ? "workflow" : "code";
          const panel = api.getPanel(panelId);
          if (panel) panel.api.setActive();
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
  );
}
