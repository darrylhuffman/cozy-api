import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useThemeStore } from "./theme.js"

beforeEach(() => {
  localStorage.clear()
  // Reset store to a known state
  useThemeStore.setState({ theme: "light" })
  // Clear the html class
  document.documentElement.classList.remove("dark")
})

afterEach(() => {
  localStorage.clear()
  useThemeStore.setState({ theme: "light" })
  document.documentElement.classList.remove("dark")
})

describe("useThemeStore", () => {
  it("starts in light mode by default (matchMedia returns false in jsdom)", () => {
    expect(useThemeStore.getState().theme).toBe("light")
  })

  it("setTheme('dark') updates state and adds .dark class to <html>", () => {
    useThemeStore.getState().setTheme("dark")
    expect(useThemeStore.getState().theme).toBe("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("setTheme('light') removes .dark class from <html>", () => {
    document.documentElement.classList.add("dark")
    useThemeStore.getState().setTheme("light")
    expect(useThemeStore.getState().theme).toBe("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("toggle() flips from light to dark", () => {
    useThemeStore.setState({ theme: "light" })
    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().theme).toBe("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("toggle() flips from dark to light", () => {
    useThemeStore.setState({ theme: "dark" })
    useThemeStore.getState().toggle()
    expect(useThemeStore.getState().theme).toBe("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })
})
