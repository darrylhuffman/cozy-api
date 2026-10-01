import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppMapView } from "./app-map-view"
import { petShop } from "./fixture.test-data"
import { buildAppMap } from "./model"

const map = buildAppMap(petShop)
vi.mock("./use-app-map", () => ({ useAppMap: () => ({ map, loaded: true }) }))

// jsdom has no canvas; labels fall back to a character-width estimate.
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)

afterEach(cleanup)

describe("AppMapView", () => {
  it("draws every route, node, middleware and provider", () => {
    render(<AppMapView />)
    expect(screen.getByRole("button", { name: "Workflow: GET /hello" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Node: Add Pet" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Middleware: requireAdmin" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Provider: db" })).toBeInTheDocument()
  })

  it("starts on Lanes and switches to Graph", () => {
    render(<AppMapView />)
    expect(screen.getByRole("tab", { name: "Lanes" })).toHaveAttribute("aria-selected", "true")
    fireEvent.click(screen.getByRole("tab", { name: "Graph" }))
    expect(screen.getByRole("tab", { name: "Graph" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("button", { name: "Provider: db" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: "Lanes" }))
  })

  it("shows details for the selected item", () => {
    render(<AppMapView />)
    fireEvent.keyDown(screen.getByRole("button", { name: "Provider: logger" }), { key: "Enter" })
    const details = screen.getByRole("complementary", { name: "Map details" })
    expect(details).toHaveTextContent("Provider")
    expect(details).toHaveTextContent("Audit Log")
  })

  it("hides a kind when its switch is off", () => {
    render(<AppMapView />)
    fireEvent.click(screen.getByRole("switch", { name: "Show providers" }))
    expect(screen.queryByRole("button", { name: "Provider: db" })).toBeNull()
  })

  it("narrows the map to what a focus connects to", () => {
    render(<AppMapView />)
    fireEvent.keyDown(screen.getByRole("button", { name: "Workflow: GET /hello" }), {
      key: "Enter",
    })
    fireEvent.click(screen.getByRole("button", { name: "Focus the map on this" }))
    expect(screen.getByRole("button", { name: "Node: Say Hello" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Node: Add Pet" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(screen.getByRole("button", { name: "Node: Add Pet" })).toBeInTheDocument()
  })
})
