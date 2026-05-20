export type FileKind = "workflow" | "node"

export interface FileLeaf {
  type: "file"
  id: string // unique within the tree
  name: string // display name (e.g., "create.workflow")
  kind: FileKind
}

export interface FileFolder {
  type: "folder"
  id: string
  name: string
  children: FileNode[]
}

export type FileNode = FileLeaf | FileFolder

export const mockWorkflows: FileFolder = {
  type: "folder",
  id: "wf-root",
  name: "workflows",
  children: [
    {
      type: "folder",
      id: "wf-users",
      name: "users",
      children: [
        { type: "file", id: "wf-users-create", name: "create.workflow", kind: "workflow" },
        {
          type: "folder",
          id: "wf-users-id",
          name: "[id]",
          children: [
            { type: "file", id: "wf-users-id-get", name: "get.workflow", kind: "workflow" },
            { type: "file", id: "wf-users-id-update", name: "update.workflow", kind: "workflow" },
          ],
        },
      ],
    },
    {
      type: "folder",
      id: "wf-auth",
      name: "auth",
      children: [{ type: "file", id: "wf-auth-login", name: "login.workflow", kind: "workflow" }],
    },
  ],
}

export const mockNodes: FileFolder = {
  type: "folder",
  id: "n-root",
  name: "nodes",
  children: [
    {
      type: "folder",
      id: "n-shared",
      name: "shared",
      children: [
        { type: "file", id: "n-shared-parseBody", name: "parseBody.ts", kind: "node" },
        { type: "file", id: "n-shared-validateEmail", name: "validateEmail.ts", kind: "node" },
      ],
    },
    {
      type: "folder",
      id: "n-users",
      name: "users",
      children: [
        { type: "file", id: "n-users-save", name: "saveUser.ts", kind: "node" },
        { type: "file", id: "n-users-hash", name: "hashPassword.ts", kind: "node" },
      ],
    },
  ],
}
