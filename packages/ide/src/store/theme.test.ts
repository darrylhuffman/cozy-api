import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { THEMES } from "@/lib/themes"
import { applyStoredTheme, resolveTheme, useThemeStore } from "./theme.js"

function reset() {
  localStorage.clear()
  useThemeStore.setState({ theme: "light", systemDark: false })
  document.documentElement.classList.remove("dark")
  document.documentElement.removeAttribute("style")
}

beforeEach(reset)
afterEach(reset)

describe("useThemeStore", () => {
  it("setTheme('dark') updates state and adds .dark class to <html>", () => {
    useThemeStore.getState().setTheme("dark")
    expect(useThemeStore.getState().theme).toBe("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("setTheme('light') removes .dark class from <html>", () => {
    document.documentElement.classList.add("dark")
    useThemeStore.getState().setTheme("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("a VS Code-based theme sets its tokens on <html>", () => {
    useThemeStore.getState().setTheme("dracula")
    const root = document.documentElement
    expect(root.dataset.theme).toBe("dracula")
    expect(root.classList.contains("dark")).toBe(true)
    expect(root.style.getPropertyValue("--background")).toBe("#282a36")
    expect(root.style.getPropertyValue("--primary")).toBe("#bd93f9")
  })

  it("light themes drop the .dark class", () => {
    useThemeStore.getState().setTheme("dracula")
    useThemeStore.getState().setTheme("github-light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#f6f8fa")
  })

  it("'system' follows the OS with lorien's own themes", () => {
    expect(resolveTheme("system", true).id).toBe("dark")
    expect(resolveTheme("system", false).id).toBe("light")
  })

  it("applies the stored theme before React mounts", () => {
    localStorage.setItem("lorien-ide-theme", JSON.stringify({ state: { theme: "nord" } }))
    applyStoredTheme()
    expect(document.documentElement.dataset.theme).toBe("nord")
  })

  it("ignores an unknown stored theme", () => {
    localStorage.setItem("lorien-ide-theme", JSON.stringify({ state: { theme: "neon" } }))
    applyStoredTheme()
    expect(document.documentElement.dataset.theme).toBe("light")
  })
})

describe("THEMES", () => {
  it("has unique ids and both modes", () => {
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(THEMES.some((t) => t.mode === "light")).toBe(true)
    expect(THEMES.some((t) => t.mode === "dark")).toBe(true)
  })
})
