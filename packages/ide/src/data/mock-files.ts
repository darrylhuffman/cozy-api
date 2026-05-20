export type FileKind = "workflow" | "node"

export interface FileLeaf {
  type: "file"
  id: string // unique within the tree
  name: string // display name (e.g., "create.workflow")
  kind: FileKind
  path?: string // relative path from workspace root (e.g., "workflows/users/create.workflow")
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
        {
          type: "file",
          id: "wf-users-create",
          name: "create.workflow",
          kind: "workflow",
          path: "workflows/users/create.workflow",
        },
        {
          type: "folder",
          id: "wf-users-id",
          name: "[id]",
          children: [
            {
              type: "file",
              id: "wf-users-id-get",
              name: "get.workflow",
              kind: "workflow",
              path: "workflows/users/[id]/get.workflow",
            },
            {
              type: "file",
              id: "wf-users-id-update",
              name: "update.workflow",
              kind: "workflow",
              path: "workflows/users/[id]/update.workflow",
            },
          ],
        },
      ],
    },
    {
      type: "folder",
      id: "wf-auth",
      name: "auth",
      children: [
        {
          type: "file",
          id: "wf-auth-login",
          name: "login.workflow",
          kind: "workflow",
          path: "workflows/auth/login.workflow",
        },
      ],
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
        {
          type: "file",
          id: "n-shared-parseBody",
          name: "parseBody.ts",
          kind: "node",
          path: "nodes/shared/parseBody.ts",
        },
        {
          type: "file",
          id: "n-shared-validateEmail",
          name: "validateEmail.ts",
          kind: "node",
          path: "nodes/shared/validateEmail.ts",
        },
      ],
    },
    {
      type: "folder",
      id: "n-users",
      name: "users",
      children: [
        {
          type: "file",
          id: "n-users-save",
          name: "saveUser.ts",
          kind: "node",
          path: "nodes/users/saveUser.ts",
        },
        {
          type: "file",
          id: "n-users-hash",
          name: "hashPassword.ts",
          kind: "node",
          path: "nodes/users/hashPassword.ts",
        },
      ],
    },
  ],
}
