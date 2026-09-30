import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS, useSettings, useSettingsDialog } from "@/store/settings"
import { useThemeStore } from "@/store/theme"
import { SettingsDialogHost } from "./settings-dialog.js"

beforeEach(() => {
  localStorage.clear()
  useThemeStore.setState({ theme: "light", systemDark: false })
  useSettings.setState(DEFAULT_SETTINGS)
  useSettingsDialog.setState({ open: true })
})
afterEach(() => {
  cleanup()
  useSettingsDialog.setState({ open: false })
  document.documentElement.classList.remove("dark")
  document.documentElement.removeAttribute("style")
})

describe("Settings dialog", () => {
  it("picking a theme card applies it", () => {
    render(<SettingsDialogHost />)
    expect(screen.getByRole("radio", { name: "Lorien Light" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    fireEvent.click(screen.getByRole("radio", { name: "Tokyo Night" }))
    expect(useThemeStore.getState().theme).toBe("tokyo-night")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(screen.getByRole("radio", { name: "Tokyo Night" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
  })

  it("lists the VS Code-based themes", () => {
    render(<SettingsDialogHost />)
    for (const name of [
      "One Dark Pro",
      "Dracula",
      "Tokyo Night",
      "Nord",
      "GitHub Light",
      "Solarized Light",
    ]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument()
    }
  })

  it("Match system switches to 'system' and back to the theme on screen", () => {
    render(<SettingsDialogHost />)
    const toggle = screen.getByRole("switch", { name: "Match system" })
    fireEvent.click(toggle)
    expect(useThemeStore.getState().theme).toBe("system")
    fireEvent.click(toggle)
    expect(useThemeStore.getState().theme).toBe("light")
  })

  it("code editor settings update the store", () => {
    render(<SettingsDialogHost />)
    fireEvent.click(screen.getByRole("button", { name: "Code editor" }))
    fireEvent.click(screen.getByRole("button", { name: "Larger font" }))
    expect(useSettings.getState().editorFontSize).toBe(14)
    fireEvent.click(screen.getByRole("switch", { name: "Word wrap" }))
    expect(useSettings.getState().editorWordWrap).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }))
    expect(useSettings.getState().editorFontSize).toBe(13)
  })

  it("canvas settings update the store", () => {
    render(<SettingsDialogHost />)
    fireEvent.click(screen.getByRole("button", { name: "Canvas" }))
    fireEvent.click(screen.getByRole("radio", { name: "Grid" }))
    expect(useSettings.getState().canvasBackground).toBe("lines")
    fireEvent.click(screen.getByRole("switch", { name: "Snap to grid" }))
    expect(useSettings.getState().canvasSnapToGrid).toBe(true)
  })

  it("Ctrl+, opens it", () => {
    useSettingsDialog.setState({ open: false })
    render(<SettingsDialogHost />)
    fireEvent.keyDown(window, { key: ",", ctrlKey: true })
    expect(useSettingsDialog.getState().open).toBe(true)
  })
})
