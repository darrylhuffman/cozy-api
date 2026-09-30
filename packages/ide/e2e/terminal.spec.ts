import { expect, test } from "./fixtures.js"

test("opens a terminal in the bottom panel and runs a command in the project folder", async ({
  ide,
}) => {
  await ide.locator(".dv-tab", { hasText: "Terminal" }).click()
  const panel = ide.getByTestId("terminal-panel")
  const tabs = panel.getByRole("tablist", { name: "Terminals" }).getByRole("tab")
  await expect(tabs).toHaveCount(1)

  const screen = panel.locator("[data-testid=terminal]:not(.invisible) .xterm-rows")
  await panel.getByTestId("terminal").click()
  await ide.keyboard.type("echo lorien-$((1+1)) && basename $(pwd)")
  await ide.keyboard.press("Enter")
  await expect(screen).toContainText("lorien-2")
  await expect(screen).toContainText("basic-api")

  // A second tab runs its own shell; closing it leaves the first.
  await panel.getByRole("button", { name: "New terminal", exact: true }).click()
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true")
  await panel
    .getByRole("button", { name: /^Close / })
    .nth(1)
    .click()
  await expect(tabs).toHaveCount(1)
  await expect(screen).toContainText("lorien-2")

  // Exiting the shell says so.
  await panel.getByTestId("terminal").click()
  await ide.keyboard.type("exit 4")
  await ide.keyboard.press("Enter")
  await expect(screen).toContainText("Process exited with code 4")
})

test("Ctrl+` opens the terminal", async ({ ide }) => {
  await ide.keyboard.press("Control+Backquote")
  await expect(ide.getByTestId("terminal-panel")).toBeVisible()
})
