/**
 * Line diffs for Source Control: the change hunks a diff view stages or
 * discards one at a time, and the change marks in the code editor's gutter.
 */

/** One run of changed lines. Ranges are 0-based and end-exclusive. */
export interface Hunk {
  baseStart: number
  baseEnd: number
  headStart: number
  headEnd: number
}

export type HunkKind = "added" | "removed" | "modified"

export function hunkKind(h: Hunk): HunkKind {
  if (h.baseStart === h.baseEnd) return "added"
  if (h.headStart === h.headEnd) return "removed"
  return "modified"
}

/** Splits text into lines that keep their line endings, so joining them gives the text back. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

/** Past this many edits the diff gives up and reports one hunk for the rest. */
const MAX_EDITS = 4000

/**
 * The hunks that turn `base` into `head` (Myers' O(ND) diff over lines).
 * A missing final newline counts as a change to that line.
 */
export function diffLines(base: string, head: string): Hunk[] {
  const a = splitLines(base)
  const b = splitLines(head)
  // Common prefix and suffix never make hunks.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const n = endA - start
  const m = endB - start
  if (n === 0 && m === 0) return []
  if (n === 0 || m === 0) {
    return [{ baseStart: start, baseEnd: endA, headStart: start, headEnd: endB }]
  }

  const max = Math.min(n + m, MAX_EDITS)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
  }
  if (found < 0) {
    // Too different to be worth aligning: one hunk for the whole middle.
    return [{ baseStart: start, baseEnd: endA, headStart: start, headEnd: endB }]
  }

  // Walk back through the trace, marking which lines were removed or added.
  const removed = new Uint8Array(n)
  const added = new Uint8Array(m)
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const prev = trace[d]!
    const k = x - y
    const down = k === -d || (k !== d && prev[offset + k - 1]! < prev[offset + k + 1]!)
    const prevK = down ? k + 1 : k - 1
    const prevX = prev[offset + prevK]!
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
    }
    if (down) added[--y] = 1
    else removed[--x] = 1
  }

  // Group runs of removed and added lines between matching lines.
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && !removed[i] && !added[j]) {
      i++
      j++
      continue
    }
    const h = { baseStart: start + i, baseEnd: 0, headStart: start + j, headEnd: 0 }
    while (i < n && removed[i]) i++
    while (j < m && added[j]) j++
    h.baseEnd = start + i
    h.headEnd = start + j
    hunks.push(h)
  }
  return hunks
}

/**
 * Applies one hunk: "to-head" takes the head's lines into the base (staging a
 * change); "to-base" puts the base's lines back into the head (discarding or
 * unstaging it).
 */
export function applyHunk(
  base: string,
  head: string,
  hunk: Hunk,
  direction: "to-head" | "to-base",
): string {
  const a = splitLines(base)
  const b = splitLines(head)
  if (direction === "to-head") {
    return [
      ...a.slice(0, hunk.baseStart),
      ...b.slice(hunk.headStart, hunk.headEnd),
      ...a.slice(hunk.baseEnd),
    ].join("")
  }
  return [
    ...b.slice(0, hunk.headStart),
    ...a.slice(hunk.baseStart, hunk.baseEnd),
    ...b.slice(hunk.headEnd),
  ].join("")
}
