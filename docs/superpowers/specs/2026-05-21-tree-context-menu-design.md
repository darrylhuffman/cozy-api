# File-Tree Context Menu & Folder-Aware Create Dialogs — Design Spec

**Status:** Approved (design phase)
**Date:** 2026-05-21
**Scope:** `packages/ide` (frontend) + `packages/build` (one new backend endpoint)

## Goal

Let the user right-click anywhere in the WORKFLOWS or NODES tree to create new folders and new workflows/nodes scoped to a target folder. Replace the existing free-form "path" input in the New Custom Node dialog with a folder picker + name input flow that auto-appends the correct extension.

## Why

Today the only way to create a node is the workflow editor's canvas context menu, which exposes a free-form path text field. There is no way to create a new workflow from inside the IDE at all, and no way to create folders. Users editing in the files panel have to drop to a terminal. The proposed flow makes file/folder creation discoverable, scoped, and consistent with the user's existing mental model of folder targeting.

## Non-Goals

- Renaming or moving files/folders. (Out of scope — separate feature.)
- Deleting files/folders.
- Drag-and-drop into folders.
- Multi-select operations.
- Templates beyond the existing minimal node template and the existing workflow JSON template.

## User-Facing Behavior

### Right-click targets

When the user right-clicks inside a tree, the **target folder** is resolved by this rule:

1. Right-click on a **folder row** → that folder is the target. (Creates go *inside* the targeted folder, not as siblings.)
2. Right-click on a **file row** → the file's parent folder is the target.
3. Right-click on **empty space** within a tree section → that tree's root (`workflows/` or `nodes/`).

The gap between the WORKFLOWS and NODES sections is outside both trees; right-clicking there shows no custom menu (the browser default appears).

The context menu is scoped per tree:

- **WORKFLOWS tree**: `New folder…`, `New workflow…`
- **NODES tree**: `New folder…`, `New node…`

When the workspace tree could not load (the panel is in `loadState === "fallback"` showing mock data), menu items are **disabled** — creating against mock data would silently fail to persist.

### Create dialogs (workflow & node)

Both dialogs share the same layout:

```
┌─────────────────────────────────────────┐
│ New workflow                            │
├─────────────────────────────────────────┤
│ Folder:  workflows/users/      [Change] │
│   ▼ (when "Change" clicked — inline)    │
│   ┌───────────────────────────────────┐ │
│   │ ▾ workflows                       │ │
│   │   ▾ users                ←select  │ │
│   │     ▸ [id]                        │ │
│   │   ▸ auth                          │ │
│   └───────────────────────────────────┘ │
│                                         │
│ Name:  [ create                       ] │
│        .workflow will be appended       │
│                                         │
│              [ Cancel ]  [ Create ]     │
└─────────────────────────────────────────┘
```

- **Folder field**: shows the selected folder path (relative, e.g. `workflows/users/`). Default = the target folder resolved from the right-click context.
- **[Change] button**: toggles an inline collapsible tree picker right beneath the folder field. Picker is scoped to the relevant root: workflows dialog only shows workflow folders; node dialog only shows node folders. Clicking a folder selects it; the picker auto-collapses.
- **Name input**: single text input. Placeholder shows an example (`create` for workflows, `my-node` for nodes). Help text below: `.workflow will be appended` or `.ts will be appended`.
- **Validation**: name must be non-empty and contain no `/`. If the user types the extension anyway, it is stripped silently before submit (so `create.workflow` and `create` both result in `create.workflow`). Inline error if validation fails or backend returns 409.

### New folder dialog

Same shape but simpler:

```
┌─────────────────────────────────────────┐
│ New folder                              │
├─────────────────────────────────────────┤
│ Inside:  workflows/users/      [Change] │
│ Name:    [ admin                      ] │
│                                         │
│              [ Cancel ]  [ Create ]     │
└─────────────────────────────────────────┘
```

Same folder-picker, same validation rule (no `/`, no extension needed).

### Post-create

- New file or folder appears in the tree (refresh path differs — see Architecture).
- Files: existing SSE `add` event triggers `refreshTree()`.
- Folders: empty dirs don't emit chokidar events; dialog refreshes the tree manually on success.
- New workflow files open in a tab and focus the workflow editor (matches existing file-click behavior).
- New node files open in a code-editor tab.

## Architecture

### File map

| File | Action | Purpose |
|---|---|---|
| `packages/ide/src/components/ui/context-menu.tsx` | **new** | shadcn primitive wrapper over `radix-ui` ContextMenu (Root/Trigger/Content/Item/Separator). Style parity with existing `menubar.tsx`. |
| `packages/ide/src/panels/files-panel.tsx` | **modify** | Wrap each `Folder_`/`Leaf` in a `<ContextMenu>` (or attach `onContextMenu`). Owns the "selected target folder" state and the open/close state for the three dialogs. |
| `packages/ide/src/workflow/folder-picker.tsx` | **new** | Reusable inline collapsible folder tree. Props: `{ root: FileFolder; value: string; onChange: (folder: string) => void }`. Shows only folder rows from the given root. |
| `packages/ide/src/workflow/new-node-dialog.tsx` | **refactor** | Replace single text input with `FolderPicker` + name input. Props gain `defaultFolder?: string` (defaults to `nodes/`). Existing call sites (workflow editor) updated to pass no folder. |
| `packages/ide/src/workflow/new-workflow-dialog.tsx` | **new** | Mirror of `NewNodeDialog`, creates `.workflow` files with the existing workflow template (empty `{ "lorien": 1, "nodes": {} }`). |
| `packages/ide/src/workflow/new-folder-dialog.tsx` | **new** | Folder-picker + name input, calls new backend folder endpoint. |
| `packages/ide/src/lib/api.ts` | **modify** | Add `createWorkspaceFolder(path: string): Promise<void>`. |
| `packages/build/src/commands/ide.ts` | **modify** | Add `POST /api/workspace/folder` route — `mkdir -p` inside workspace root with path-traversal guard. |
| `packages/build/src/commands/ide.test.ts` | **modify** | Add tests for the new folder endpoint (happy path, traversal rejection, idempotent on existing). |

### Component contracts

**`ContextMenu` primitives** — match existing shadcn convention:
- Re-export `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem`, `ContextMenuSeparator` from `radix-ui`'s `ContextMenu` namespace with project styling.

**`FolderPicker`**:
- `root: FileFolder` — the tree to display.
- `value: string` — currently selected folder path (relative to workspace, e.g. `"workflows/users"`).
- `onChange(path: string): void` — fires on folder selection.
- Internally renders only folder rows (skips file leaves). Reuses tree-expand state pattern from `files-panel.tsx`.

**`NewNodeDialog` (refactored)**:
- Props: `{ open, onOpenChange, onCreated, defaultFolder?: string, nodesTree: FileFolder }`.
- Default `defaultFolder = "nodes"`.
- Submit: `await createWorkspaceFile("${folder}/${stripExt(name)}.ts", template)`.

**`NewWorkflowDialog`**:
- Props: `{ open, onOpenChange, onCreated, defaultFolder?: string, workflowsTree: FileFolder }`.
- Default `defaultFolder = "workflows"`.
- Submit: `await createWorkspaceFile("${folder}/${stripExt(name)}.workflow", '{"lorien":1,"nodes":{}}\n')`.
- On success, opens the new workflow as a tab and focuses the workflow editor panel.

**`NewFolderDialog`**:
- Props: `{ open, onOpenChange, onCreated, defaultFolder: string, root: FileFolder }`.
- Submit: `await createWorkspaceFolder("${folder}/${name}")`.
- On success, calls `refreshTree()` (passed in or via the file-events subscriber).

### Backend endpoint

**`POST /api/workspace/folder`**
- Body: `{ path: string }` (relative to workspace root).
- Validates: path resolves inside `workspaceRoot` (existing traversal-guard pattern).
- Action: `mkdir(abs, { recursive: true })`.
- Response: `200 { path }` on success; `200 { path }` if dir already exists (idempotent); `403` on traversal; `400` on missing/invalid `path`; `500` on filesystem error.
- Note: must NOT enforce the `.ts`/`.workflow` whitelist (folders have no extension).

### State flow

```
right-click in FilesPanel
  → derive targetFolder (folder | file's parent | tree root)
  → setMenuState({ tree: "workflows"|"nodes", folder: targetFolder, action: "new-folder"|"new-workflow"|"new-node" })
  → open corresponding dialog with defaultFolder=targetFolder
  → user submits
  → call createWorkspaceFile or createWorkspaceFolder
  → refreshTree() on folder; SSE `add` event will refresh on file
  → for new workflow/node files, also openTab() + focus panel
```

## Error Handling

- **Empty name**: inline error `"Name is required"` — Create button disabled until name is non-empty after trim.
- **Name contains `/`**: inline error `"Name cannot contain slashes"`.
- **409 from backend (file exists)**: inline error `"A file with that name already exists in this folder"`.
- **403 (traversal)**: shouldn't happen via UI but if it does, show `"Invalid path"`.
- **Network error**: show backend error message in red text below the inputs (matches existing dialog convention).

## Testing Strategy

### Frontend unit tests

**`files-panel.test.tsx`** — new test block "right-click context menu":
1. Right-click a folder row → menu opens with the two relevant items.
2. Right-click a file row → menu opens; target folder is the file's parent (verified by inspecting dialog's default folder when opened).
3. Right-click empty space in WORKFLOWS section → target is workflows root.
4. When `loadState === "fallback"`, menu items are disabled.
5. Workflows tree shows `New folder…` and `New workflow…`; nodes tree shows `New folder…` and `New node…`.

**`folder-picker.test.tsx`** (new):
1. Renders only folder rows (no files).
2. Clicking a folder calls `onChange` with the full relative path.
3. `value` prop drives the visual "selected" state.
4. Scoped to the passed `root` — does not show siblings outside.

**`new-node-dialog.test.tsx`** (updated):
1. Default folder reflects `defaultFolder` prop.
2. "Change" toggles picker visibility.
3. Selecting a folder updates the field and collapses the picker.
4. Name input strips trailing `.ts` if user types it.
5. Submit calls `createWorkspaceFile` with `<folder>/<name>.ts` and the template.
6. Existing behavior preserved: on success, `onCreated(uses)` fires with the relative `uses` path.

**`new-workflow-dialog.test.tsx`** (new): mirror of node-dialog tests, asserting `.workflow` extension and seeded workflow JSON.

**`new-folder-dialog.test.tsx`** (new): folder picker default, submit calls `createWorkspaceFolder`, success triggers `onCreated`.

### Backend tests

**`ide.test.ts`** — new describe `POST /api/workspace/folder`:
1. Creates folder inside workspace; verifies it exists on disk.
2. Creating an existing folder returns 200 (idempotent).
3. Creating nested path (`a/b/c`) creates all parents.
4. Path-traversal attempt (`../escape`) returns 403.
5. Missing `path` in body returns 400.

## Open Questions

None. The two design questions (folder-picker UX, folder backend) were answered:
- Folder picker: inline collapsible.
- Folder persistence: dedicated `POST /api/workspace/folder` endpoint.

## Implementation Notes

- Use the existing `radix-ui` namespaced import pattern (`import { ContextMenu as ContextMenuPrimitive } from "radix-ui"`).
- `FolderPicker` shares the visual style of the existing tree but is **never editable** (no files, no draggable, no openTab).
- Tree state for the picker can be local (each picker instance manages its own expanded set) — folder paths are short enough that re-expanding on each open is fine.
- `files-panel.tsx` mounts all three dialogs; they're conditionally rendered based on `menuState.action`.
- The workflow editor's canvas-context-menu "+ New custom node…" path keeps working: it invokes `NewNodeDialog` without `defaultFolder`, gets the default `nodes/`, and the post-create canvas-insert behavior is unchanged.
