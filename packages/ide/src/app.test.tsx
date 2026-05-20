import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { App } from "./app.js"

afterEach(() => {
  cleanup()
})

describe("App", () => {
  it("renders the IDE title", () => {
    render(<App />)
    expect(screen.getByText("cozy-api IDE")).toBeInTheDocument()
  })

  it("renders a shadcn Button", () => {
    render(<App />)
    expect(screen.getByRole("button", { name: /shadcn button installed/i })).toBeInTheDocument()
  })
})
