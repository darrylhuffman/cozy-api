import Editor from "@monaco-editor/react"
import { useDebugSessionStore, type BodyKind } from "@/store/debug-session"
import { useThemeStore } from "@/store/theme"
import { KeyValueGrid } from "./key-value-grid"

const LANGUAGE_BY_KIND: Record<"json" | "xml" | "text", string> = {
  json: "json",
  xml: "xml",
  text: "plaintext",
}

export function BodyEditor() {
  const bodyKind = useDebugSessionStore((s) => s.requestForm.bodyKind)
  const body = useDebugSessionStore((s) => s.requestForm.body)
  const formBody = useDebugSessionStore((s) => s.requestForm.formBody)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)
  const theme = useThemeStore((s) => s.theme)

  if (bodyKind === "none") return null

  if (bodyKind === "form") {
    return (
      <KeyValueGrid
        pairs={formBody}
        onChange={(next) => setRequestForm((c) => ({ ...c, formBody: next }))}
      />
    )
  }

  // json / xml / text — Monaco. Keyed by kind so React remounts when the
  // language switches; avoids a stale model on the same Monaco instance.
  return (
    <div className="overflow-hidden rounded-md border">
      <Editor
        key={bodyKind}
        height={160}
        defaultLanguage={LANGUAGE_BY_KIND[bodyKind as "json" | "xml" | "text"]}
        value={body}
        theme={theme === "dark" ? "vs-dark" : "vs"}
        onChange={(v) => setRequestForm((c) => ({ ...c, body: v ?? "" }))}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: "on",
        }}
      />
    </div>
  )
}
