import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { App } from "./app.js"

describe("App", () => {
  it("renders the IDE title", () => {
    render(<App />)
    expect(screen.getByText("cozy-api IDE")).toBeInTheDocument()
  })
})
