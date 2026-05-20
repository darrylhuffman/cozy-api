import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
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

describe("Topbar theme toggle", () => {
  it("renders the toggle button", () => {
    render(<Topbar />)
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeInTheDocument()
  })

  it("toggle button flips theme from light to dark", () => {
    useThemeStore.setState({ theme: "light" })
    render(<Topbar />)
    fireEvent.click(screen.getByRole("button", { name: /toggle theme/i }))
    expect(useThemeStore.getState().theme).toBe("dark")
  })

  it("toggle button flips theme from dark to light", () => {
    useThemeStore.setState({ theme: "dark" })
    render(<Topbar />)
    fireEvent.click(screen.getByRole("button", { name: /toggle theme/i }))
    expect(useThemeStore.getState().theme).toBe("light")
  })
})
