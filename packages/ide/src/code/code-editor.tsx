import Editor from "@monaco-editor/react"
import { useEffect, useState } from "react"
import { fetchFile } from "@/lib/api"
import { useThemeStore } from "@/store/theme"

interface Props {
  /** API path like "nodes/parse-credentials.ts" */
  path: string
}

export function CodeEditor({ path }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const theme = useThemeStore((s) => s.theme)

  useEffect(() => {
    let alive = true
    setContent(null)
    setError(null)
    fetchFile(path)
      .then((file) => {
        if (alive) setContent(file.content)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [path])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
        Error loading file: {error}
      </div>
    )
  }
  if (content === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Loading {path}…
      </div>
    )
  }

  return (
    <div className="h-full w-full">
      <Editor
        height="100%"
        defaultLanguage="typescript"
        path={path}
        value={content}
        theme={theme === "dark" ? "vs-dark" : "vs"}
        options={{
          readOnly: true,
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
