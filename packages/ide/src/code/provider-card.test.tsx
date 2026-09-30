import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProviderInfo } from "@/lib/api"
import { resetProvidersStore, useProvidersStore } from "@/store/providers"
import { useTabsStore } from "@/store/tabs"
import { FileContextBar } from "./provider-card"

vi.mock("@/lib/events", () => ({ subscribeToFileEvents: vi.fn(() => () => {}) }))

const db: ProviderInfo = {
  name: "db",
  path: "providers/db.ts",
  label: "Pet store database",
  lifetime: "singleton",
  uses: ["logger"],
  env: [
    { key: "DATABASE_URL", status: "missing" },
    { key: "POOL_SIZE", status: "default" },
  ],
  hasDispose: true,
  packages: ["better-sqlite3"],
  usedBy: ["nodes/pets/add-pet.ts"],
}
const logger: ProviderInfo = {
  ...db,
  name: "logger",
  path: "providers/logger.ts",
  uses: [],
  env: [],
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeId: null, activeWorkflowId: null, activeCodeId: null })
  useProvidersStore.setState({
    providers: [db, logger],
    nodes: { "./nodes/pets/add-pet": ["db", "logger"], "./nodes/hello": [] },
    loaded: true,
  })
})
afterEach(() => {
  cleanup()
  resetProvidersStore()
})

describe("FileContextBar", () => {
  it("describes a provider: lifetime, deps, env, packages and readers", () => {
    render(<FileContextBar path="providers/db.ts" />)
    const card = screen.getByRole("region", { name: "Provider db" })
    expect(card).toHaveTextContent("Pet store database")
    expect(card).toHaveTextContent("singleton")
    expect(card).toHaveTextContent("Created once when the app starts")
    expect(card).toHaveTextContent("DATABASE_URL missing")
    expect(card).toHaveTextContent("better-sqlite3")
    expect(card).toHaveTextContent("Set DATABASE_URL before starting the app")
    fireEvent.click(screen.getByRole("button", { name: "pets/add-pet" }))
    expect(useTabsStore.getState().activeCodeId).toBe("nodes/pets/add-pet.ts")
    fireEvent.click(screen.getByRole("button", { name: "logger" }))
    expect(useTabsStore.getState().activeCodeId).toBe("providers/logger.ts")
  })

  it("lists the providers a node reads, and nothing for one that reads none", () => {
    const { rerender } = render(<FileContextBar path="nodes/pets/add-pet.ts" />)
    expect(screen.getByTestId("node-providers-bar")).toHaveTextContent("Readsdblogger")
    rerender(<FileContextBar path="nodes/hello.ts" />)
    expect(screen.queryByTestId("node-providers-bar")).not.toBeInTheDocument()
  })

  it("shows nothing for private provider code or lib files", () => {
    const { container, rerender } = render(<FileContextBar path="providers/db/open.ts" />)
    expect(container).toBeEmptyDOMElement()
    rerender(<FileContextBar path="lib/schemas.ts" />)
    expect(container).toBeEmptyDOMElement()
  })
})
