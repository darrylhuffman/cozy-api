/**
 * Reads `user.id`, `items[0].name`, `[2]` or `data["odd key"]` out of a value.
 * Returns `{ found: false }` when any segment is missing.
 */
export function readPath(
  value: unknown,
  path: string | undefined,
): { found: boolean; value: unknown } {
  if (!path) return { found: true, value }
  const segments = parsePath(path)
  if (!segments) return { found: false, value: undefined }
  let cur: unknown = value
  for (const seg of segments) {
    if (cur === null || typeof cur !== "object") return { found: false, value: undefined }
    if (!Object.hasOwn(cur as object, seg)) return { found: false, value: undefined }
    cur = (cur as Record<string, unknown>)[seg]
  }
  return { found: true, value: cur }
}

export function parsePath(path: string): string[] | null {
  const out: string[] = []
  let i = 0
  let expectDot = false
  while (i < path.length) {
    const ch = path[i]!
    if (ch === "[") {
      const close = path.indexOf("]", i)
      if (close === -1) return null
      let inner = path.slice(i + 1, close).trim()
      if (
        (inner.startsWith('"') && inner.endsWith('"')) ||
        (inner.startsWith("'") && inner.endsWith("'"))
      ) {
        inner = inner.slice(1, -1)
      }
      out.push(inner)
      i = close + 1
      expectDot = true
      continue
    }
    if (ch === ".") {
      if (!expectDot) return null
      i++
      expectDot = false
      continue
    }
    let j = i
    while (j < path.length && path[j] !== "." && path[j] !== "[") j++
    out.push(path.slice(i, j))
    i = j
    expectDot = true
  }
  return out
}
