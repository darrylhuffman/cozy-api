import { expect, test } from "./fixtures.js"

test("renames a node from the explorer and the workflow that uses it follows", async ({ ide }) => {
  const explorer = ide.getByTestId("files-panel")
  try {
    await explorer.getByRole("button", { name: "find-pet.ts" }).click({ button: "right" })
    await ide.getByRole("menuitem", { name: "Rename…" }).click()
    await ide.getByLabel("New name").fill("lookup-pet")
    await ide.getByRole("button", { name: "Rename", exact: true }).click()
    await expect(explorer.getByRole("button", { name: "lookup-pet.ts" })).toBeVisible()

    const wf = await (
      await ide.request.get("/api/workspace/file?path=workflows/pets/get.workflow")
    ).json()
    expect(wf.content).toContain('"./nodes/pets/lookup-pet"')
  } finally {
    await ide.request.post("/api/workspace/rename", {
      data: { from: "nodes/pets/lookup-pet.ts", to: "nodes/pets/find-pet.ts" },
    })
  }
})

test("deletes a workflow from the explorer after asking", async ({ ide }) => {
  const path = "workflows/pets/scratch.workflow"
  await ide.request.put(`/api/workspace/file?path=${path}&create=true`, {
    data: '{\n  "lorien": 1,\n  "nodes": {}\n}\n',
  })
  const explorer = ide.getByTestId("files-panel")
  try {
    await explorer.getByRole("button", { name: "scratch.workflow" }).click({ button: "right" })
    await ide.getByRole("menuitem", { name: "Delete" }).click()
    await expect(ide.getByText("Delete scratch.workflow?")).toBeVisible()
    await ide.getByRole("button", { name: "Delete", exact: true }).click()
    await expect(explorer.getByRole("button", { name: "scratch.workflow" })).toHaveCount(0)
  } finally {
    await ide.request.delete(`/api/workspace/file?path=${path}`)
  }
})
