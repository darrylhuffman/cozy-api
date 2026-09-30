import { expect, test } from "./fixtures.js"
import { editWorkflow, type Sandbox, startSandbox } from "./git-sandbox.js"

// Branch work happens in a throwaway repository with its own IDE server.
let sb: Sandbox
test.beforeAll(async () => {
  sb = await startSandbox(8197)
})
test.afterAll(async () => {
  await sb?.stop()
})

const pageErrors: string[] = []
test.beforeEach(({ page }) => {
  pageErrors.length = 0
  page.on("pageerror", (e) => pageErrors.push(e.message))
})
test.afterEach(() => {
  expect(pageErrors, "uncaught errors in the page").toEqual([])
})

test("switches, creates and merges branches, resolving a workflow conflict visually", async ({
  page,
}) => {
  // Main and a feature branch both change ListPets: a conflict.
  sb.git("switch", "-q", "-c", "feature/species")
  editWorkflow(sb.workspace, (wf) => {
    wf.nodes.ListPets.in.species = "Request.query.kind"
    wf.nodes.Response.values = { status: 202 }
  })
  sb.git("commit", "-qam", "Read species from ?kind")
  sb.git("switch", "-q", "main")
  editWorkflow(sb.workspace, (wf) => {
    wf.nodes.ListPets.in.species = "Request.query.type"
  })
  sb.git("commit", "-qam", "Read species from ?type")

  await page.goto(sb.url)
  await expect(page.getByText("WORKFLOWS", { exact: true })).toBeVisible()
  await page.getByTestId("status-git").click()
  const panel = page.getByTestId("source-control")
  await expect(panel.getByTestId("git-branch")).toHaveText("main")

  // Create a branch, then switch back through the menu.
  await panel.getByTestId("branch-menu").click()
  await page.getByLabel("Find or create a branch").fill("try-things")
  await page.getByRole("button", { name: /^Create try-things/ }).click()
  await expect(panel.getByTestId("git-branch")).toHaveText("try-things")
  await panel.getByTestId("branch-menu").click()
  await page.getByRole("button", { name: "Switch to main" }).click()
  await expect(panel.getByTestId("git-branch")).toHaveText("main")

  // Merge the feature branch: ListPets conflicts, Response combines.
  await panel.getByTestId("branch-menu").click()
  await page.getByRole("button", { name: "Switch to feature/species" }).hover()
  await page.getByRole("button", { name: "Merge feature/species into main" }).click()
  await expect(panel.getByTestId("merge-banner")).toContainText("Merging feature/species into main")
  await expect(panel.getByTestId("merge-banner")).toContainText("1 conflict to resolve")
  await expect(panel.getByRole("button", { name: "Commit merge" })).toBeDisabled()

  await panel
    .getByRole("region", { name: "Conflicts" })
    .getByRole("button", { name: /^list\.workflow/ })
    .click()
  const view = page.getByTestId("conflict-view")
  const card = view.getByTestId("merge-conflict")
  await expect(card).toContainText("ListPets")
  await expect(card).toContainText("← Request.query.type")
  await expect(card).toContainText("← Request.query.kind")
  // The graph shows what comes in from theirs: Response's new status.
  await expect(view.locator('[data-testid="diff-node"][data-state="changed"]')).toContainText(
    "Response",
  )
  await card.getByRole("button", { name: "Theirs" }).click()
  await view.getByRole("button", { name: "Save merge and mark resolved" }).click()
  await expect(view).toContainText("Resolved")

  await expect(panel.getByTestId("merge-banner")).toContainText("All conflicts resolved")
  await expect(panel.getByLabel("Commit message")).toHaveValue("Merge branch 'feature/species'")
  await panel.getByRole("button", { name: "Commit merge" }).click()
  await expect(panel.getByTestId("merge-banner")).toHaveCount(0)
  const merged = JSON.parse(sb.git("show", "HEAD:apps/api/workflows/pets/list.workflow"))
  expect(merged.nodes.ListPets.in.species).toBe("Request.query.kind")
  expect(merged.nodes.Response.values).toEqual({ status: 202 })
})

test("fetches, pulls and pushes", async ({ page }) => {
  await page.goto(sb.url)
  await page.getByTestId("status-git").click()
  const panel = page.getByTestId("source-control")
  await expect(panel.getByTestId("git-branch")).toHaveText("main")

  // Push the merge from the first test.
  await panel.getByRole("button", { name: "Push" }).click()
  await expect(async () => {
    expect(sb.git("rev-parse", "HEAD")).toBe(sb.git("rev-parse", "origin/main"))
  }).toPass()

  // Someone else pushes; fetch shows it, pull brings it in.
  sb.pushFromElsewhere(
    "main",
    (wf) => {
      wf.nodes.Response.values = { status: 200 }
    },
    "Back to 200",
  )
  await panel.getByRole("button", { name: "Fetch" }).click()
  await expect(panel.getByRole("button", { name: "Pull" })).toContainText("1")
  await panel.getByRole("button", { name: "Pull" }).click()
  await expect(panel.getByRole("region", { name: "History" })).toContainText("Back to 200")
})
