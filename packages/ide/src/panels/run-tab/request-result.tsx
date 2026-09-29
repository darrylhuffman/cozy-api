import type { Assertion, RequestRunResult } from "@darrylondil/lorien-runtime/requests"
import { CheckCircle2, Sparkles, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Checks that describe a response as it is now — a quick way to pin current
 * behaviour: its status, its content type, and which top-level fields exist.
 */
export function assertionsFromResponse(r: RequestRunResult): Assertion[] {
  if (!r.response) return []
  const out: Assertion[] = [{ target: "status", op: "equals", value: r.response.status }]
  const ct = Object.entries(r.response.headers).find(
    ([k]) => k.toLowerCase() === "content-type",
  )?.[1]
  if (ct)
    out.push({
      target: "header",
      path: "content-type",
      op: "contains",
      value: ct.split(";")[0]!.trim(),
    })
  const body = r.response.body
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const key of Object.keys(body).slice(0, 8)) {
      if (/^[A-Za-z_$][\w$]*$/.test(key)) out.push({ target: "body", path: key, op: "exists" })
    }
  } else if (Array.isArray(body)) {
    out.push({ target: "body", op: "type", value: "array" })
  }
  return out
}

export function RequestResult({
  result,
  onAddChecks,
  onAskAi,
}: {
  result: RequestRunResult
  onAddChecks?: (checks: Assertion[]) => void
  /** Shown on failures: hand the request, response and checks to Claude. */
  onAskAi?: () => void
}) {
  const res = result.response
  const bodyText =
    res === undefined
      ? ""
      : typeof res.body === "string"
        ? res.body
        : JSON.stringify(res.body, null, 2)
  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="request-result">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-medium",
            result.passed
              ? "bg-green-500/15 text-green-700 dark:text-green-400"
              : "bg-red-500/15 text-red-700 dark:text-red-400",
          )}
        >
          {result.passed ? "Passed" : "Failed"}
        </span>
        {res && (
          <span className="font-mono text-muted-foreground">
            {res.status} · {res.durationMs}ms
          </span>
        )}
        <span className="truncate font-mono text-muted-foreground" title={result.request.url}>
          {result.request.method} {result.request.url}
        </span>
      </div>
      {result.error && (
        <div className="text-red-700 dark:text-red-400">Request failed: {result.error}</div>
      )}
      {result.missingVariables.length > 0 && (
        <div className="text-amber-700 dark:text-amber-400">
          Undefined variables: {result.missingVariables.map((v) => `{{${v}}}`).join(", ")}. Add them
          to the environment, or capture them from an earlier request.
        </div>
      )}
      {result.assertions.length > 0 && (
        <ul className="flex flex-col gap-0.5" aria-label="Check results">
          {result.assertions.map((a, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: results mirror the assertion order
            <li key={i} className="flex items-start gap-1.5">
              {a.pass ? (
                <CheckCircle2
                  className="mt-px h-3.5 w-3.5 shrink-0 text-green-600"
                  aria-label="passed"
                />
              ) : (
                <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-red-600" aria-label="failed" />
              )}
              <span className={a.pass ? "text-muted-foreground" : ""}>{a.message}</span>
            </li>
          ))}
        </ul>
      )}
      {Object.keys(result.captured).length > 0 && (
        <div className="text-muted-foreground">
          Captured:{" "}
          {Object.entries(result.captured).map(([k, v]) => (
            <span key={k} className="mr-2 font-mono">
              {k}={v.length > 40 ? `${v.slice(0, 37)}...` : v}
            </span>
          ))}
        </div>
      )}
      {res && onAddChecks && result.assertions.length === 0 && (
        <button
          type="button"
          className="self-start rounded-md border px-2 py-0.5 text-[11px] hover:bg-accent"
          onClick={() => onAddChecks(assertionsFromResponse(result))}
        >
          Add checks from this response
        </button>
      )}
      {res && (
        <>
          <pre
            className="max-h-64 overflow-auto rounded-md bg-muted/40 p-2 text-[11px]"
            data-testid="response-body"
          >
            {bodyText || "(empty body)"}
          </pre>
          <details className="text-muted-foreground">
            <summary>Response headers</summary>
            <pre className="max-h-24 overflow-auto rounded-md bg-muted/40 p-2 text-[10px]">
              {Object.entries(res.headers)
                .map(([k, v]) => `${k}: ${v}`)
                .join("\n")}
            </pre>
          </details>
        </>
      )}
    </div>
  )
}
