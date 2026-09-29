import { ChevronDown, ChevronRight, Folder as FolderIcon, FolderOpen } from "lucide-react"
import { useState } from "react"
import type { FileFolder, FileNode } from "@/data/mock-files"
import { cn } from "@/lib/utils"

interface Props {
  root: FileFolder
  value: string
  onChange: (path: string) => void
}

export function FolderPicker({ root, value, onChange }: Props) {
  return (
    <div
      className="max-h-48 overflow-auto rounded border border-border bg-muted/30 p-1"
      data-testid="folder-picker"
    >
      <FolderRow
        node={root}
        path={root.name}
        depth={0}
        value={value}
        onChange={onChange}
        defaultOpen
      />
    </div>
  )
}

function FolderRow({
  node,
  path,
  depth,
  value,
  onChange,
  defaultOpen = false,
}: {
  node: Extract<FileNode, { type: "folder" }>
  path: string
  depth: number
  value: string
  onChange: (path: string) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const selected = path === value
  const childFolders = node.children.filter(
    (c): c is Extract<FileNode, { type: "folder" }> => c.type === "folder",
  )

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          onChange(path)
        }}
        className={cn(
          "flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
          selected && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: depth * 8 + 4 }}
      >
        {childFolders.length > 0 ? (
          open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )
        ) : (
          <span className="inline-block h-3 w-3" />
        )}
        {open ? (
          <FolderOpen className="h-3.5 w-3.5" />
        ) : (
          <FolderIcon className="h-3.5 w-3.5" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <div>
          {childFolders.map((child) => (
            <FolderRow
              key={child.id}
              node={child}
              path={`${path}/${child.name}`}
              depth={depth + 1}
              value={value}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}
