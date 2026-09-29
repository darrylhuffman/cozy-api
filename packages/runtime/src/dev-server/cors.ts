/**
 * Returns true when the given origin is a loopback URL (localhost / 127.0.0.1 / [::1]).
 * Used to gate dev-only endpoints so the IDE can fetch across origins without
 * exposing them to the wider web.
 */
export function isLoopbackOriginString(origin: string | undefined | null): boolean {
  if (!origin) return false
  try {
    const u = new URL(origin)
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "[::1]"
    )
  } catch {
    return false
  }
}
