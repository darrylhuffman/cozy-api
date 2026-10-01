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
