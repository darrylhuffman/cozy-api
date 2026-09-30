import Editor from "@monaco-editor/react"
import { ChevronRight } from "lucide-react"
import { useState } from "react"
import { defineMonacoThemes, monacoThemeName } from "@/lib/monaco-theme"
import { cn } from "@/lib/utils"
import { useSettings } from "@/store/settings"
import { useActiveTheme } from "@/store/theme"

type View = "tree" | "raw"

/** Monaco's language for a content type; JSON bodies arrive already parsed. */
export function languageForContentType(contentType: string | undefined): string {
  const ct = (contentType ?? "").toLowerCase()
  if (ct.includes("json")) return "json"
  if (ct.includes("html")) return "html"
  if (ct.includes("xml")) return "xml"
  if (ct.includes("javascript")) return "javascript"
  if (ct.includes("css")) return "css"
  return "plaintext"
}

/**
 * A response body. JSON opens as a tree with its top level showing, with a
 * Raw tab; anything else is shown raw. Raw is a small read-only editor, so it
 * gets syntax highlighting.
 */
export function ResponseBody({
  body,
  contentType,
}: {
  body: unknown
  contentType?: string | undefined
}) {
  const isJson = body !== undefined && typeof body !== "string"
  const [view, setView] = useState<View>("tree")
  const text =
    body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body, null, 2)
  const shown: View = isJson ? view : "raw"

  return (
    <div className="flex flex-col gap-1.5" data-testid="response-body">
      {isJson && (
        <div
          role="tablist"
          aria-label="Response view"
          className="flex gap-0.5 self-start rounded-md bg-muted p-0.5"
        >
          {(["tree", "raw"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "rounded px-2 py-0.5 text-[11.5px]",
                view === v
                  ? "bg-popover font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "tree" ? "Tree" : "Raw"}
            </button>
          ))}
        </div>
      )}
      {text === "" ? (
        <div className="rounded-md border border-border bg-background p-2 font-mono text-[11px] text-muted-foreground">
          (empty body)
        </div>
      ) : shown === "tree" ? (
        <div
          className="max-h-72 overflow-auto rounded-md border border-border bg-background py-1 font-mono text-[11.5px]"
          data-testid="response-tree"
        >
          <JsonTree value={body} />
        </div>
      ) : (
        <RawBody text={text} language={isJson ? "json" : languageForContentType(contentType)} />
      )}
    </div>
  )
}

const LINE_HEIGHT = 18

function RawBody({ text, language }: { text: string; language: string }) {
  const theme = useActiveTheme()
  const fontSize = useSettings((s) => s.editorFontSize)
  const lines = text.split("\n").length
  return (
    <div className="overflow-hidden rounded-md border border-border" data-testid="response-raw">
      <Editor
        height={Math.min(300, Math.max(3, lines) * LINE_HEIGHT + 12)}
        language={language}
        value={text}
        theme={monacoThemeName(theme)}
        beforeMount={defineMonacoThemes}
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: false },
          fontSize: Math.min(fontSize, 12),
          lineHeight: LINE_HEIGHT,
          lineNumbers: "off",
          folding: true,
          fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: "on",
          renderLineHighlight: "none",
          padding: { top: 6, bottom: 6 },
        }}
      />
    </div>
  )
}

/** `{ 3 }` / `[ 12 ]`: how much is inside a collapsed object or array. */
function summary(v: object): string {
  return Array.isArray(v) ? `[ ${v.length} ]` : `{ ${Object.keys(v).length} }`
}

function Scalar({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return <span className="break-all text-success">{JSON.stringify(value)}</span>
  }
  if (typeof value === "number") return <span className="text-info">{value}</span>
  return <span className="text-warning">{String(value)}</span>
}

/** A JSON value as a tree: its top level shows, deeper objects open on click. */
export function JsonTree({ value }: { value: unknown }) {
  if (value === null || typeof value !== "object") {
    return (
      <div className="px-2">
        <Scalar value={value} />
      </div>
    )
  }
  const entries = Object.entries(value)
  if (entries.length === 0) {
    return <div className="px-2 text-muted-foreground">{Array.isArray(value) ? "[]" : "{}"}</div>
  }
  return (
    <ul aria-label="Response body">
      {entries.map(([k, v]) => (
        <TreeRow key={k} name={Array.isArray(value) ? Number(k) : k} value={v} depth={0} />
      ))}
    </ul>
  )
}

function TreeRow({ name, value, depth }: { name: string | number; value: unknown; depth: number }) {
  const [open, setOpen] = useState(false)
  const branch = value !== null && typeof value === "object" && Object.keys(value).length > 0
  const row = (
    <>
      {branch ? (
        <ChevronRight
          aria-hidden
          className={cn(
            "mt-[3px] size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <span
        className={cn(
          "shrink-0",
          typeof name === "number" ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {name}
        <span className="text-muted-foreground">:</span>
      </span>
      {branch ? (
        <span className="text-muted-foreground">{summary(value as object)}</span>
      ) : value !== null && typeof value === "object" ? (
        <span className="text-muted-foreground">{Array.isArray(value) ? "[]" : "{}"}</span>
      ) : (
        <Scalar value={value} />
      )}
    </>
  )
  const rowClass = "flex w-full items-start gap-1 pr-2 text-left leading-[20px]"
  const indent = { paddingLeft: 4 + depth * 14 }
  return (
    <li>
      {branch ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn(rowClass, "hover:bg-accent")}
          style={indent}
        >
          {row}
        </button>
      ) : (
        <div className={rowClass} style={indent}>
          {row}
        </div>
      )}
      {branch && open && (
        <ul>
          {Object.entries(value as object).map(([k, v]) => (
            <TreeRow
              key={k}
              name={Array.isArray(value) ? Number(k) : k}
              value={v}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
