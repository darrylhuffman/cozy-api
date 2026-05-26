import { afterEach, describe, expect, it } from "vitest"
import { useRequestHistoryStore } from "./request-history"

describe("useRequestHistoryStore", () => {
  afterEach(() => {
    useRequestHistoryStore.setState({ entries: [] })
  })

  it("addEntry returns an id and stores an in-flight entry", () => {
    const id = useRequestHistoryStore.getState().addEntry({
      workflowPath: "wf",
      triggerNodeId: "req",
      request: { method: "POST", path: "/x" },
      startedAt: 1000,
    })
    expect(id).toBeTruthy()
    const entry = useRequestHistoryStore.getState().entries[0]!
    expect(entry.id).toBe(id)
    expect(entry.outcome.kind).toBe("in-flight")
  })

  it("setResponse with status<400 sets outcome.ok", () => {
    const s = useRequestHistoryStore.getState()
    const id = s.addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    s.setResponse(id, { status: 200, headers: { "content-type": "application/json" }, body: { ok: true }, durationMs: 42 })
    expect(useRequestHistoryStore.getState().entries[0]?.outcome.kind).toBe("ok")
  })

  it("setResponse with status>=400 sets outcome.error", () => {
    const s = useRequestHistoryStore.getState()
    const id = s.addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    s.setResponse(id, { status: 500, headers: {}, body: { error: "boom" }, durationMs: 5 })
    expect(useRequestHistoryStore.getState().entries[0]?.outcome.kind).toBe("error")
  })

  it("setError sets outcome.network-error", () => {
    const s = useRequestHistoryStore.getState()
    const id = s.addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    s.setError(id, "connection refused")
    const out = useRequestHistoryStore.getState().entries[0]?.outcome
    expect(out?.kind).toBe("network-error")
    if (out?.kind === "network-error") expect(out.message).toBe("connection refused")
  })

  it("caps at 20 entries; newest first", () => {
    const s = useRequestHistoryStore.getState()
    for (let i = 0; i < 22; i++) {
      s.addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: `/x/${i}` }, startedAt: 1000 + i })
    }
    const entries = useRequestHistoryStore.getState().entries
    expect(entries.length).toBe(20)
    expect(entries[0]?.request.path).toBe("/x/21")
  })

  it("clear empties the list", () => {
    const s = useRequestHistoryStore.getState()
    s.addEntry({ workflowPath: "wf", triggerNodeId: "req", request: { method: "GET", path: "/x" }, startedAt: 1000 })
    s.clear()
    expect(useRequestHistoryStore.getState().entries).toEqual([])
  })
})
