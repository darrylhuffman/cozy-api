import { describe, expect, it } from "vitest"
import { applyHunk, diffLines, hunkKind, splitLines } from "./line-diff"

describe("line diff", () => {
  it("splits lines keeping their endings", () => {
    expect(splitLines("a\nb\nc")).toEqual(["a\n", "b\n", "c"])
    expect(splitLines("a\n")).toEqual(["a\n"])
    expect(splitLines("")).toEqual([])
  })

  it("finds added, removed and modified runs", () => {
    const base = "one\ntwo\nthree\nfour\nfive\n"
    const head = "zero\none\nTWO\nthree\nfive\nsix\n"
    const hunks = diffLines(base, head)
    expect(hunks).toEqual([
      { baseStart: 0, baseEnd: 0, headStart: 0, headEnd: 1 },
      { baseStart: 1, baseEnd: 2, headStart: 2, headEnd: 3 },
      { baseStart: 3, baseEnd: 4, headStart: 4, headEnd: 4 },
      { baseStart: 5, baseEnd: 5, headStart: 5, headEnd: 6 },
    ])
    expect(hunks.map(hunkKind)).toEqual(["added", "modified", "removed", "added"])
    expect(diffLines(base, base)).toEqual([])
  })

  it("treats a missing final newline as a change", () => {
    expect(diffLines("a\nb\n", "a\nb")).toEqual([
      { baseStart: 1, baseEnd: 2, headStart: 1, headEnd: 2 },
    ])
  })

  it("stages or discards one hunk and leaves the rest", () => {
    const base = "one\ntwo\nthree\nfour\nfive\n"
    const head = "zero\none\nTWO\nthree\nfive\nsix\n"
    const hunks = diffLines(base, head)
    // Staging the second hunk: the base takes TWO, nothing else.
    const staged = applyHunk(base, head, hunks[1]!, "to-head")
    expect(staged).toBe("one\nTWO\nthree\nfour\nfive\n")
    expect(diffLines(staged, head)).toHaveLength(3)
    // Discarding the third hunk puts "four" back into the head.
    expect(applyHunk(base, head, hunks[2]!, "to-base")).toBe(
      "zero\none\nTWO\nthree\nfour\nfive\nsix\n",
    )
    // Applying every hunk in turn, last first, gets the other side.
    let text = base
    for (const h of [...hunks].reverse()) text = applyHunk(text, head, h, "to-head")
    expect(text).toBe(head)
  })

  it("handles whole-file adds and deletes", () => {
    expect(diffLines("", "a\nb\n")).toEqual([
      { baseStart: 0, baseEnd: 0, headStart: 0, headEnd: 2 },
    ])
    expect(diffLines("a\n", "")).toEqual([{ baseStart: 0, baseEnd: 1, headStart: 0, headEnd: 0 }])
  })

  it("round-trips random edits", () => {
    let seed = 7
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    for (let t = 0; t < 200; t++) {
      const lines = Array.from({ length: rand(12) }, () => `${rand(4)}\n`)
      const edited = lines.flatMap((l) => {
        const r = rand(6)
        return r === 0 ? [] : r === 1 ? [l, `${rand(4)}\n`] : r === 2 ? [`x${rand(3)}\n`] : [l]
      })
      const base = lines.join("")
      const head = edited.join("")
      const hunks = diffLines(base, head)
      let text = base
      for (const h of [...hunks].reverse()) text = applyHunk(text, head, h, "to-head")
      expect(text).toBe(head)
      let back = head
      for (const h of [...hunks].reverse()) back = applyHunk(base, back, h, "to-base")
      expect(back).toBe(base)
    }
  })
})
