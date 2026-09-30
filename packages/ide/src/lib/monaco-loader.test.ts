import { describe, expect, it, vi } from "vitest"

const config = vi.fn()
vi.mock("@monaco-editor/react", () => ({ loader: { config: (c: unknown) => config(c) } }))

import { configureMonacoLoader } from "./monaco-loader"

describe("configureMonacoLoader", () => {
  it("loads Monaco from the IDE's own origin, not a CDN", () => {
    configureMonacoLoader("http://localhost:3737/")
    expect(config).toHaveBeenCalledWith({ paths: { vs: "http://localhost:3737/monaco/vs" } })
  })
})
