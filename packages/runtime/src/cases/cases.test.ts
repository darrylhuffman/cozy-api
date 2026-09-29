import { describe, expect, it } from "vitest"
import { CaseFileError, casesPathFor, judgeCase, nodeFileForUses, parseCaseFile } from "./index.js"

describe("case files", () => {
  it("maps node files and uses to case files", () => {
    expect(casesPathFor("nodes/users/save-user.ts")).toBe("nodes/users/save-user.cases.json")
    expect(nodeFileForUses("./nodes/users/save-user")).toBe("nodes/users/save-user.ts")
    expect(nodeFileForUses("@core/response")).toBeNull()
  })

  it("parses a valid file", () => {
    const f = parseCaseFile(
      JSON.stringify({
        lorien: 1,
        cases: [
          {
            id: "a",
            name: "A",
            input: { x: 1 },
            mocks: { db: { get: { returns: 1 }, put: { throws: "nope" } } },
            expect: { output: { y: 2 } },
          },
        ],
      }),
    )
    expect(f.cases[0]?.mocks?.db?.put).toEqual({ throws: "nope" })
  })

  it("lists every problem", () => {
    try {
      parseCaseFile(
        JSON.stringify({
          cases: [
            { id: "a", name: "A", input: [], expect: {} },
            {
              id: "b",
              name: "B",
              input: {},
              expect: { match: "roughly" },
              mocks: { db: { get: {} } },
            },
          ],
        }),
        "x.cases.json",
      )
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(CaseFileError)
      expect((e as CaseFileError).problems).toEqual([
        "cases[0].input must be an object",
        'cases[1].expect.match must be "contains" or "equals"',
        'cases[1].mocks.db.get must be { "returns": value } or { "throws": "message" }',
      ])
    }
  })
})

describe("judgeCase", () => {
  it("matches output as a subset by default", () => {
    expect(
      judgeCase({ output: { user: { id: "1" } } }, { output: { user: { id: "1", email: "e" } } }),
    ).toEqual([])
    expect(
      judgeCase(
        { output: { user: { id: "1" } }, match: "equals" },
        { output: { user: { id: "1", email: "e" } } },
      ),
    ).toHaveLength(1)
  })

  it("expects errors", () => {
    expect(judgeCase({ error: "email" }, { error: "invalid email" })).toEqual([])
    expect(judgeCase({ error: "" }, { error: "anything" })).toEqual([])
    expect(judgeCase({ error: "email" }, { output: { ok: true } })).toEqual([
      'expected an error containing "email", but it returned {"ok":true}',
    ])
    expect(judgeCase({ output: {} }, { error: "boom" })).toEqual(["threw: boom"])
  })
})
