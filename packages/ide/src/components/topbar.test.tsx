import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useSettingsDialog } from "@/store/settings"
import { useThemeStore } from "@/store/theme"
import { Topbar } from "./topbar.js"

beforeEach(() => {
  localStorage.clear()
  useThemeStore.setState({ theme: "light" })
  document.documentElement.classList.remove("dark")
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  useThemeStore.setState({ theme: "light" })
  document.documentElement.classList.remove("dark")
})

describe("Topbar settings", () => {
  it("the gear button opens Settings", () => {
    useSettingsDialog.setState({ open: false })
    render(<Topbar />)
    fireEvent.click(screen.getByRole("button", { name: /^settings$/i }))
    expect(useSettingsDialog.getState().open).toBe(true)
  })
})
