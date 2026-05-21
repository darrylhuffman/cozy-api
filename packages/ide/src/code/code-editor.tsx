import Editor, { type OnMount } from "@monaco-editor/react"
import { useEffect, useRef, useState } from "react"
import { fetchFile, saveFile } from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"
import { useTabsStore } from "@/store/tabs"
import { useThemeStore } from "@/store/theme"

interface Props {
  /** API path like "nodes/parse-credentials.ts" */
  path: string
  /** Tab ID so we can update dirty state in the store. */
  tabId: string
}

type Status = "idle" | "saving" | "saved" | "error"

export function CodeEditor({ path, tabId }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const theme = useThemeStore((s) => s.theme)
  const setDirty = useTabsStore((s) => s.setDirty)

  const currentValueRef = useRef<string>("")
  // Track whether the user has made local edits that haven't been saved
  const locallyDirtyRef = useRef(false)

  const doFetch = () => {
    let alive = true
    setContent(null)
    setError(null)
    locallyDirtyRef.current = false
    setDirty(tabId, false)
    fetchFile(path)
      .then((file) => {
        if (!alive) return
        setContent(file.content)
        currentValueRef.current = file.content
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }

  useEffect(() => {
    return doFetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Subscribe to live file-change events; reload if the file changed externally
  // unless the user has unsaved local edits (don't clobber their work).
  useEffect(() => {
    return subscribeToFileEvents((e) => {
      if (e.path !== path) return
      if (locallyDirtyRef.current) return // keep local edits
      doFetch()
    })
    // doFetch is stable per path mount; exclude from deps to avoid re-subscribing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  const save = async () => {
    setStatus("saving")
    try {
      await saveFile(path, currentValueRef.current)
      locallyDirtyRef.current = false
      setDirty(tabId, false)
      setStatus("saved")
      setStatusMessage("Saved")
      setTimeout(() => setStatus("idle"), 1500)
    } catch (e) {
      setStatus("error")
      setStatusMessage((e as Error).message)
    }
  }

  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => {
        void save()
      },
    )
  }

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
    <div className="relative h-full w-full">
      <Editor
        height="100%"
        defaultLanguage="typescript"
        path={path}
        value={content}
        theme={theme === "dark" ? "vs-dark" : "vs"}
        onMount={onMount}
        onChange={(v) => {
          currentValueRef.current = v ?? ""
          if (!locallyDirtyRef.current) {
            locallyDirtyRef.current = true
            setDirty(tabId, true)
          }
        }}
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
      {status !== "idle" && statusMessage && (
        <div
          className={
            status === "error"
              ? "absolute bottom-3 right-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs text-destructive"
              : "absolute bottom-3 right-3 rounded-md border border-border bg-card px-3 py-1 text-xs text-muted-foreground"
          }
        >
          {statusMessage}
        </div>
      )}
    </div>
  )
}
