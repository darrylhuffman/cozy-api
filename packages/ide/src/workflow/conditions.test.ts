import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import {
  conditionLabel,
  conditionOptions,
  downstreamOf,
  flipCondition,
  parseCondition,
  setCondition,
} from "./conditions"

const wf: WorkflowFile = {
  lorien: 1,
  nodes: {
    request: { uses: "@core/http-request" },
    find: { uses: "./find-room", in: { id: "request.params.id" } },
    missing: { uses: "@core/http-response", when: "!find.found" },
    book: { uses: "./book", when: "find.found", in: { room: "find.room" } },
    booked: { uses: "@core/http-response", in: { body: "book" } },
  },
}

describe("parseCondition", () => {
  it("reads the reference and its polarity", () => {
    expect(parseCondition("find.found")).toEqual({
      ref: "find.found",
      nodeId: "find",
      path: ["found"],
      negate: false,
    })
    expect(parseCondition("!find.room.open")).toMatchObject({
      ref: "find.room.open",
      path: ["room", "open"],
      negate: true,
    })
    expect(parseCondition("find")).toMatchObject({ nodeId: "find", path: [] })
  })

  it("rejects what isn't a reference", () => {
    expect(parseCondition(undefined)).toBeNull()
    expect(parseCondition("")).toBeNull()
    expect(parseCondition("!")).toBeNull()
    expect(parseCondition("find.found == true")).toBeNull()
  })
})

describe("conditionLabel", () => {
  it("names the branch by the output's last segment", () => {
    expect(conditionLabel(parseCondition("find.found")!)).toBe("if found")
    expect(conditionLabel(parseCondition("!find.room.open")!)).toBe("if not open")
    expect(conditionLabel(parseCondition("find")!)).toBe("if find")
  })
})

describe("setCondition / flipCondition", () => {
  it("sets, flips and clears `when`", () => {
    const set = setCondition(wf, "booked", "book.ok")
    expect(set.nodes.booked?.when).toBe("book.ok")
    expect(flipCondition(set, "booked").nodes.booked?.when).toBe("!book.ok")
    expect(flipCondition(wf, "missing").nodes.missing?.when).toBe("find.found")
    const cleared = setCondition(wf, "missing", null)
    expect("when" in cleared.nodes.missing!).toBe(false)
  })

  it("returns the same workflow when nothing changes", () => {
    expect(setCondition(wf, "book", "find.found")).toBe(wf)
    expect(setCondition(wf, "booked", null)).toBe(wf)
    expect(flipCondition(wf, "booked")).toBe(wf)
  })
})

describe("downstreamOf", () => {
  it("follows inputs and conditions", () => {
    expect([...downstreamOf(wf, "find")].sort()).toEqual(["book", "booked", "missing"])
    expect([...downstreamOf(wf, "book")]).toEqual(["booked"])
  })
})

describe("conditionOptions", () => {
  it("lists other nodes' outputs, booleans first, skipping anything downstream", () => {
    const schemas = {
      "./find-room": {
        inputs: { type: "object" },
        outputs: {
          type: "object",
          properties: {
            room: {
              type: "object",
              properties: { name: { type: "string" }, open: { type: "boolean" } },
            },
            found: { type: "boolean" },
          },
        },
      },
      "./book": {
        inputs: { type: "object" },
        outputs: { type: "object", properties: { ok: { type: "boolean" } } },
      },
    }
    const refs = conditionOptions(wf, schemas, "book").map((o) => o.ref)
    expect(refs).toEqual(["find.room.open", "find.found", "find.room", "find.room.name"])
    // `booked` reads `book`, so `book` can't branch on it... but the reverse is fine.
    expect(conditionOptions(wf, schemas, "booked").map((o) => o.ref)).toContain("book.ok")
  })
})
