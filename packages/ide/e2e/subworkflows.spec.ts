import { expect, test } from "./fixtures.js"

const SUB = "nodes/pets/scratch-lookup.workflow"
const CALLER = "workflows/pets/scratch-caller.workflow"

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

test("creates a sub-workflow from the Explorer and edits its inputs and outputs", async ({
  ide,
}) => {
  const explorer = ide.getByTestId("files-panel")
  try {
    await explorer.getByRole("button", { name: "find-pet.ts" }).click({ button: "right" })
    await ide.getByRole("menuitem", { name: "New sub-workflow…" }).click()
    await ide.getByPlaceholder("reserve-seats").fill("scratch-lookup")
    await ide.getByRole("button", { name: "Create" }).click()

    const banner = ide.getByTestId("subworkflow-banner")
    await expect(banner).toContainText("No workflow uses it yet")
    await expect(explorer.getByRole("button", { name: "scratch-lookup.workflow" })).toBeVisible()

    // An input: added, renamed and retyped on the Input card.
    await ide.getByRole("button", { name: "Add input" }).click()
    const name = ide.getByLabel("Input name input")
    await name.fill("petId")
    await name.press("Enter")
    await ide.getByLabel("Type of petId").selectOption("number")

    // Dropping the input on the Output's last row adds an output.
    const from = ide.locator('.react-flow__handle[data-nodeid="Input"][data-handleid="petId"]')
    const to = ide.locator('.react-flow__handle[data-nodeid="Output"][data-handleid="$root"]')
    await from.dragTo(to)
    await expect(ide.getByLabel("Output name petId")).toBeVisible()

    await ide.keyboard.press("Control+s")
    await expect
      .poll(async () => {
        const res = await ide.request.get(`/api/workspace/file?path=${SUB}`)
        return JSON.parse((await res.json()).content ?? "{}").nodes
      })
      .toMatchObject({
        Input: { uses: "@core/input", values: { fields: { petId: "number" } } },
        Output: { uses: "@core/output", in: { petId: "Input.petId" } },
      })
  } finally {
    await ide.request.delete(`/api/workspace/file?path=${SUB}`)
  }
})

test("a sub-workflow node opens in its own tab, with a way back", async ({ ide }) => {
  await ide.request.put(`/api/workspace/file?path=${SUB}&create=true`, {
    data: json({
      lorien: 1,
      label: "Scratch lookup",
      nodes: {
        Input: { uses: "@core/input", values: { fields: { id: "string" } } },
        Missing: {
          uses: "@core/response",
          when: "!Input.id",
          values: { status: 404, body: { error: "no id" } },
        },
        Output: { uses: "@core/output", in: { id: "Input.id" } },
      },
    }),
  })
  await ide.request.put(`/api/workspace/file?path=${CALLER}&create=true`, {
    data: json({
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request", values: { path: "/scratch/:id", method: "GET" } },
        Lookup: { uses: "./nodes/pets/scratch-lookup", in: { id: "Request.params.id" } },
        Done: { uses: "@core/response", in: { body: "Lookup.id" } },
      },
    }),
  })
  try {
    await ide.getByRole("button", { name: "scratch-caller.workflow" }).click()
    const card = ide.getByTestId("node-card").filter({ hasText: "Scratch lookup" })
    await expect(card).toContainText("flow")
    await expect(card.getByTestId("node-responds")).toContainText("404")

    // The Inspector says where it's used and opens it.
    await card.getByTestId("node-header").click()
    await expect(ide.getByText("Used in 1")).toBeVisible()

    await card.getByTestId("node-header").dblclick()
    const banner = ide.getByTestId("subworkflow-banner")
    await expect(banner).toContainText("Scratch lookup is a sub-workflow used by 1 workflow")
    await expect(ide.getByTestId("io-node")).toHaveCount(2)

    await banner.getByRole("button", { name: "pets/scratch-caller.workflow" }).click()
    await expect(ide.getByTestId("subworkflow-banner")).toBeHidden()
    await expect(card).toBeVisible()
  } finally {
    await ide.request.delete(`/api/workspace/file?path=${CALLER}`)
    await ide.request.delete(`/api/workspace/file?path=${SUB}`)
  }
})

test("moves selected nodes into a new sub-workflow, and inlines them back", async ({ ide }) => {
  const caller = "workflows/pets/scratch-extract.workflow"
  const sub = "nodes/pets/load-pet.workflow"
  await ide.request.put(`/api/workspace/file?path=${caller}&create=true`, {
    data: json({
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request", values: { path: "/scratch/:id", method: "GET" } },
        FindPet: { uses: "./nodes/pets/find-pet", in: { id: "Request.params.id" } },
        Response: {
          uses: "@core/http-response",
          in: { body: "FindPet.body", status: "FindPet.status" },
        },
      },
      view: {
        Request: { x: 40, y: 40 },
        FindPet: { x: 350, y: 40 },
        Response: { x: 660, y: 40 },
      },
    }),
  })
  try {
    await ide.getByRole("button", { name: "scratch-extract.workflow" }).click()
    const headers = ide.getByTestId("node-header")
    await expect(headers).toHaveCount(3)
    // The node's schema name shows once schemas have loaded.
    await expect(ide.getByTestId("node-card").filter({ hasText: "Find Pet" })).toBeVisible()
    await headers.nth(1).click()
    await headers.nth(2).click({ modifiers: ["Shift"] })
    await ide
      .getByRole("toolbar", { name: "2 nodes selected" })
      .getByRole("button", { name: "Move to sub-workflow" })
      .click()

    const dialog = ide.getByTestId("extract-dialog")
    // find-pet.ts is taken, so the suggestion steers clear of it.
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Find pet flow")
    await expect(dialog.getByLabel("Folder", { exact: true })).toHaveValue("pets")
    await expect(dialog).toContainText("string from Request.params.id")
    await dialog.getByLabel("Name", { exact: true }).fill("Load pet")
    await expect(dialog).toContainText("nodes/pets/load-pet.workflow")
    await dialog.getByRole("button", { name: "Move to sub-workflow" }).click()
    await expect(dialog).toBeHidden()

    const card = ide.getByTestId("node-card").filter({ hasText: "Load pet" })
    await expect(card).toBeVisible()
    await expect(headers).toHaveCount(2)
    const written = await ide.request.get(`/api/workspace/file?path=${sub}`)
    expect(JSON.parse((await written.json()).content).nodes).toMatchObject({
      Input: { uses: "@core/input", values: { fields: { id: "string" } } },
      FindPet: { uses: "./nodes/pets/find-pet", in: { id: "Input.id" } },
      Response: { uses: "@core/http-response" },
      Output: { uses: "@core/output" },
    })

    await ide.keyboard.press("Control+s")
    await expect
      .poll(async () => {
        const res = await ide.request.get(`/api/workspace/file?path=${caller}`)
        return JSON.parse((await res.json()).content ?? "{}").nodes
      })
      .toEqual({
        Request: { uses: "@core/http-request", values: { path: "/scratch/:id", method: "GET" } },
        LoadPet: { uses: "./nodes/pets/load-pet", in: { id: "Request.params.id" } },
      })

    // Inlining puts the same nodes back.
    await card.getByTestId("node-header").click({ button: "right" })
    await ide.getByRole("button", { name: /Inline sub-workflow/ }).click()
    await expect(headers).toHaveCount(3)
    await expect(ide.getByTestId("node-card").filter({ hasText: "Load pet" })).toHaveCount(0)
  } finally {
    await ide.request.delete(`/api/workspace/file?path=${caller}`)
    await ide.request.delete(`/api/workspace/file?path=${sub}`)
  }
})

test("a breakpoint in a sub-workflow's tab stops the workflow that uses it", async ({ ide }) => {
  const sub = "nodes/pets/scratch-debug-lookup.workflow"
  const caller = "workflows/pets/scratch-debug.workflow"
  await ide.request.put(`/api/workspace/file?path=${sub}&create=true`, {
    data: json({
      lorien: 1,
      label: "Debug lookup",
      nodes: {
        Input: { uses: "@core/input", values: { fields: { id: "string" } } },
        FindPet: { uses: "./nodes/pets/find-pet", in: { id: "Input.id" } },
        Output: { uses: "@core/output", in: { body: "FindPet.body", status: "FindPet.status" } },
      },
      view: { Input: { x: 0, y: 0 }, FindPet: { x: 360, y: 0 }, Output: { x: 720, y: 0 } },
    }),
  })
  await ide.request.put(`/api/workspace/file?path=${caller}&create=true`, {
    data: json({
      lorien: 1,
      nodes: {
        Request: {
          uses: "@core/http-request",
          values: { path: "/scratch-debug/:id", method: "GET" },
        },
        Lookup: { uses: "./nodes/pets/scratch-debug-lookup", in: { id: "Request.params.id" } },
        Response: {
          uses: "@core/http-response",
          in: { body: "Lookup.body", status: "Lookup.status" },
        },
      },
    }),
  })
  try {
    // The dev server picks up the new route before any breakpoint is set.
    await expect
      .poll(async () => (await ide.request.get("/scratch-debug/1")).status())
      .not.toBe(404)
    await expect(ide.getByText("Debugger connected")).toBeVisible()
    await ide.getByRole("button", { name: "scratch-debug-lookup.workflow" }).click()
    const findPet = ide.getByTestId("node-card").filter({ hasText: "Find Pet" })
    await expect(findPet).toBeVisible()
    await findPet.getByTestId("node-header").click({ button: "right" })
    await ide.getByText("Toggle breakpoint (before)").click()
    await expect(ide.locator('[data-testid="node-breakpoint-dot-before"]')).toHaveCount(1)

    const response = ide.request.get("/scratch-debug/1")
    const banner = ide.getByTestId("status-banner")
    await expect(banner).toContainText("Paused at FindPet.before in Lookup")
    // Selecting the run shows where it stopped, in the sub-workflow's tab.
    await ide.getByRole("button", { name: /paused.*scratch-debug/i }).click()
    await expect(findPet).toHaveClass(/lorien-paused/)
    // The timeline lists it by its own id, under the sub-workflow node.
    await expect(
      ide
        .getByTitle("Lookup__FindPet")
        .filter({ hasText: /^FindPet$/ })
        .first(),
    ).toBeVisible()
    await banner.getByRole("button", { name: "Continue" }).click()
    await response
    await expect(banner).toContainText("Completed")
  } finally {
    await ide.request.delete(`/api/workspace/file?path=${caller}`)
    await ide.request.delete(`/api/workspace/file?path=${sub}`)
  }
})
