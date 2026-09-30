import { beforeEach, describe, expect, it, vi } from "vitest"
import { useConfirmStore } from "@/store/confirm"
import { useTabsStore } from "@/store/tabs"

const api = vi.hoisted(() => ({
  renameWorkspaceItem: vi.fn(async () => ({ moved: [], updatedWorkflows: [] })),
  deleteWorkspaceItem: vi.fn(async () => ({ deleted: [] })),
  fetchItemUsage: vi.fn(async () => ({ usedBy: ["workflows/pets/add.workflow"] })),
}))
vi.mock("@/lib/api", () => api)

import { deleteItem, invalidName, renameItem } from "./workspace-items"

const addPet = { path: "nodes/pets/add-pet.ts", kind: "node" as const }
const addWf = { path: "workflows/pets/add.workflow", kind: "workflow" as const }

beforeEach(() => {
  vi.clearAllMocks()
  useTabsStore.setState({ tabs: [], activeId: null, activeWorkflowId: null, activeCodeId: null })
})

describe("renameItem", () => {
  it("renames in the same folder and moves an open tab to the new path, in place", async () => {
    const tabs = useTabsStore.getState()
    tabs.openTab({
      id: "wf-workflows-pets-add_workflow",
      title: "add.workflow",
      kind: "workflow",
      path: addWf.path,
    })
    tabs.openTab({ id: "other", title: "other.ts", kind: "node", path: "nodes/other.ts" })

    const to = await renameItem(addWf, "create")

    expect(to).toBe("workflows/pets/create.workflow")
    expect(api.renameWorkspaceItem).toHaveBeenCalledWith(addWf.path, to)
    const s = useTabsStore.getState()
    expect(s.tabs.map((t) => t.id)).toEqual(["wf-workflows-pets-create_workflow", "other"])
    expect(s.tabs[0]).toMatchObject({ title: "create.workflow", path: to })
    expect(s.activeId).toBe("other")
  })

  it("won't rename a file with unsaved changes, or to a bad name", async () => {
    useTabsStore
      .getState()
      .openTab({ id: addPet.path, title: "add-pet.ts", kind: "node", path: addPet.path })
    useTabsStore.getState().setDirty(addPet.path, true)
    await expect(renameItem(addPet, "create-pet")).rejects.toThrow(/Save or discard/)
    await expect(renameItem(addPet, "a/b")).rejects.toThrow()
    expect(api.renameWorkspaceItem).not.toHaveBeenCalled()
    expect(invalidName("add-pet.cases")).toBe("That suffix is reserved")
    expect(invalidName("create-pet")).toBeNull()
  })
})

describe("deleteItem", () => {
  it("asks first, naming the workflows that use the node, then deletes and closes its tab", async () => {
    useTabsStore
      .getState()
      .openTab({ id: addPet.path, title: "add-pet.ts", kind: "node", path: addPet.path })
    const done = deleteItem(addPet)
    await vi.waitFor(() => expect(useConfirmStore.getState().pending).not.toBeNull())
    const q = useConfirmStore.getState().pending
    expect(q?.title).toBe("Delete add-pet.ts?")
    expect(q?.description).toContain("pets/add.workflow")
    useConfirmStore.getState().answer(true)
    expect(await done).toBe(true)
    expect(api.deleteWorkspaceItem).toHaveBeenCalledWith(addPet.path)
    expect(useTabsStore.getState().tabs).toEqual([])
  })

  it("does nothing when the question is declined", async () => {
    const done = deleteItem(addWf)
    await vi.waitFor(() => expect(useConfirmStore.getState().pending).not.toBeNull())
    useConfirmStore.getState().answer(false)
    expect(await done).toBe(false)
    expect(api.deleteWorkspaceItem).not.toHaveBeenCalled()
  })
})
