import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { App } from "./app.js"

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe("App", () => {
  it("mounts the dockview shell", () => {
    render(<App />)
    // Dockview renders a container — at minimum, the placeholder panel text or the
    // dockview container element should be in the DOM.
    // jsdom doesn't fully simulate the dockview's tab DOM; the safe assertion is
    // that the FilesPanel placeholder renders (since dockview registers it as a component).
    // Falls back to checking the dockview root if FilesPanel isn't rendered in jsdom.
    expect(
      screen.queryByText(/Files panel/) || document.querySelector(".dv-react-part"),
    ).toBeTruthy()
  })
})
