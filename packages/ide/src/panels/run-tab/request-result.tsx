import type { Assertion, RequestRunResult } from "@darrylondil/lorien-runtime/requests"
import { Check, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { ResponseBody } from "./response-body"

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
  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card text-xs"
      data-testid="request-result"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2.5 py-2">
        <span
          className={cn(
            "shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 font-semibold",
            result.passed ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
          )}
        >
          {result.passed ? "Passed" : "Failed"}
        </span>
        {res && (
          <span className="shrink-0 whitespace-nowrap font-mono font-medium">
            {res.status} · {res.durationMs}ms
          </span>
        )}
        <span
          className="min-w-0 flex-1 truncate font-mono text-muted-foreground"
          title={result.request.url}
        >
          {result.request.method} {result.request.url}
        </span>
        {!result.passed && onAskAi && (
          <button
            type="button"
            onClick={onAskAi}
            className="flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-ai/15 px-2 text-ai hover:bg-ai/25"
          >
            <Sparkles className="size-3" /> Ask AI why it failed
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2 p-2.5">
        {result.error && (
          <div className="rounded-md bg-destructive/10 px-2 py-1 text-destructive">
            Request failed: {result.error}
          </div>
        )}
        {result.missingVariables.length > 0 && (
          <div className="rounded-md bg-warning/15 px-2 py-1 text-warning">
            Undefined variables: {result.missingVariables.map((v) => `{{${v}}}`).join(", ")}. Add
            them to the environment, or capture them from an earlier request.
          </div>
        )}
        {result.assertions.length > 0 && (
          <ul className="flex flex-col gap-0.5" aria-label="Check results">
            {result.assertions.map((a, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: results mirror the assertion order
              <li key={i} className="flex items-start gap-1.5">
                {a.pass ? (
                  <Check className="mt-px size-3.5 shrink-0 text-success" aria-label="passed" />
                ) : (
                  <X className="mt-px size-3.5 shrink-0 text-destructive" aria-label="failed" />
                )}
                <span className={a.pass ? "text-success" : "text-destructive"}>{a.message}</span>
              </li>
            ))}
          </ul>
        )}
        {Object.keys(result.captured).length > 0 && (
          <div className="font-mono text-[11px] text-muted-foreground">
            Captured:{" "}
            {Object.entries(result.captured).map(([k, v]) => (
              <span key={k} className="mr-2">
                {k}={v.length > 40 ? `${v.slice(0, 37)}...` : v}
              </span>
            ))}
          </div>
        )}
        {res && onAddChecks && result.assertions.length === 0 && (
          <button
            type="button"
            className="self-start whitespace-nowrap rounded-md px-1 py-0.5 text-primary hover:bg-accent"
            onClick={() => onAddChecks(assertionsFromResponse(result))}
          >
            Add checks from this response
          </button>
        )}
        {res && (
          <>
            <ResponseBody
              body={res.body}
              contentType={
                Object.entries(res.headers).find(([k]) => k.toLowerCase() === "content-type")?.[1]
              }
            />
            <details className="text-muted-foreground">
              <summary className="cursor-pointer select-none font-mono text-[11px]">
                Response headers ({Object.keys(res.headers).length})
              </summary>
              <pre className="mt-1 max-h-24 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[10px]">
                {Object.entries(res.headers)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("\n")}
              </pre>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
