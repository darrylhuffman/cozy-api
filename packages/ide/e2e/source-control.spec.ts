import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "./fixtures.js"

const here = dirname(fileURLToPath(import.meta.url))
const PATH = "workflows/pets/list.workflow"
const file = join(here, "..", "..", "..", "examples", "basic-api", PATH)

test("shows a changed workflow in Source Control and diffs it as a graph", async ({ ide }) => {
  const original = readFileSync(file, "utf-8")
  const wf = JSON.parse(original)
  wf.nodes.ListPets.in.status = "Request.query.state"
  wf.nodes.note = { uses: "@core/variable", values: { value: "hi" } }
  try {
    await ide.request.put("/api/workspace/file", {
      data: { path: PATH, content: `${JSON.stringify(wf, null, 2)}\n` },
    })

    // The Explorer marks the file, and Source Control lists it with a summary.
    await expect(
      ide
        .getByRole("button", { name: /^list\.workflow/ })
        .first()
        .getByRole("img", { name: "Modified" }),
    ).toBeVisible()
    await ide.getByTestId("status-git").click()
    const panel = ide.getByTestId("source-control")
    const changes = panel.getByRole("region", { name: "Changes" })
    await expect(changes).toContainText("list.workflow")
    await expect(changes).toContainText("1 node added, 1 changed")

    // Stage it and back.
    await changes.getByRole("button", { name: "Stage list.workflow" }).click()
    const staged = panel.getByRole("region", { name: "Staged" })
    await expect(staged).toContainText("list.workflow")
    await expect(panel.getByRole("button", { name: "Commit 1 file" })).toBeDisabled()
    await panel.getByRole("button", { name: "Draft message from changes" }).click()
    await expect(panel.getByLabel("Commit message")).toHaveValue(
      "Update list.workflow: add note; change ListPets",
    )
    await expect(panel.getByRole("button", { name: "Commit 1 file" })).toBeEnabled()
    await staged.getByRole("button", { name: "Unstage list.workflow" }).click()
    await expect(panel.getByRole("region", { name: "Staged" })).toHaveCount(0)

    // The visual diff marks the nodes and lists the changes.
    await changes.getByRole("button", { name: /^list\.workflow/ }).click()
    const view = ide.getByTestId("diff-view")
    await expect(view).toContainText("staged ↔ working copy")
    await expect(view.locator('[data-testid="diff-node"][data-state="added"]')).toContainText(
      "note",
    )
    await expect(view.locator('[data-testid="diff-node"][data-state="changed"]')).toContainText(
      "ListPets",
    )
    await expect(view.getByTestId("diff-row-ListPets-status")).toContainText("Request.query.state")
    const list = view.getByTestId("change-list")
    await expect(list).toContainText(
      "ListPets.status now reads Request.query.state (was Request.query.status)",
    )

    // Reverting a change writes the file back.
    await list.getByRole("button", { name: /^Revert: ListPets\.status/ }).click()
    await expect(list).not.toContainText("ListPets.status")
    await expect(changes).toContainText("1 node added")

    // JSON shows the text side by side.
    await view.getByRole("tab", { name: "JSON" }).click()
    await expect(view.locator(".monaco-diff-editor")).toBeVisible()
  } finally {
    writeFileSync(file, original)
    await ide.request.post("/api/git/unstage", { data: { paths: [PATH] } })
  }
})
