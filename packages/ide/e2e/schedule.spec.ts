import { rmSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "./fixtures.js"

const EXAMPLE = join(import.meta.dirname, "..", "..", "..", "examples", "basic-api")
const PATH = "workflows/store/restock-check.workflow"

const WORKFLOW = {
  lorien: 1,
  nodes: {
    Daily: { uses: "@core/schedule", values: { cron: "0 9 * * 1-5", timezone: "UTC" } },
    GetInventory: { uses: "./nodes/store/get-inventory", after: ["Daily"] },
  },
  view: { Daily: { x: 40, y: 40 }, GetInventory: { x: 360, y: 40 } },
}

test("a schedule node is edited in plain terms and can be run now", async ({ ide }) => {
  try {
    await ide.request.put("/api/workspace/file", {
      data: { path: PATH, content: `${JSON.stringify(WORKFLOW, null, 2)}\n` },
    })
    await ide.getByRole("button", { name: "restock-check.workflow" }).click()

    // The card says when it runs; clicking it opens the editor.
    const strip = ide.getByTestId("node-schedule")
    await expect(strip).toContainText("Every weekday at 09:00")
    await strip.click()
    const editor = ide.getByTestId("schedule-editor")
    await expect(editor.getByTestId("schedule-summary")).toHaveText("Every weekday at 09:00")
    await expect(editor.getByTestId("schedule-upcoming").locator("li")).toHaveCount(5)
    // Its outputs are wired like any trigger's.
    await expect(ide.getByTestId("node-card").first()).toContainText("scheduledAt")
    await ide.screenshot({ path: "test-results/schedule-weekly.png" })

    await editor.getByRole("button", { name: "Saturday" }).click()
    await editor.getByLabel("Time of day").fill("07:30")
    await expect(editor.getByTestId("schedule-summary")).toHaveText(
      "Every Monday to Saturday at 07:30",
    )
    await expect(strip).toContainText("at 07:30")
    await expect(ide.getByText(/Unsaved changes/)).toBeVisible()

    await editor.getByRole("button", { name: "Monthly" }).click()
    await editor.getByRole("button", { name: "15", exact: true }).click()
    await expect(editor.getByTestId("schedule-summary")).toHaveText(
      "On the 15th of every month at 07:30",
    )
    await editor.getByLabel("Time zone").fill("Europe/Paris")
    await expect(editor).toContainText("30 7 15 * * · Europe/Paris")
    await ide.screenshot({ path: "test-results/schedule-monthly.png" })

    await editor.getByRole("button", { name: "Custom" }).click()
    await editor.getByLabel("Cron expression").fill("0 25 * * *")
    await expect(editor.getByRole("alert")).toHaveText("Hour: 25 is out of range (0-23)")

    // Run now runs the saved file through the dev server.
    await editor.getByRole("button", { name: "Run now" }).click()
    await expect(editor).toContainText("Ran. The run is in the Debug panel.")
  } finally {
    rmSync(join(EXAMPLE, PATH), { force: true })
  }
})
