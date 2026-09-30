import Editor, { type OnMount } from "@monaco-editor/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { EditorNotice } from "@/components/editor-notice"
import { fetchFile, saveFile } from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"
import { defineMonacoThemes, monacoThemeName } from "@/lib/monaco-theme"
import { setupWorkspaceTypes } from "@/lib/monaco-types"
import { isCodeDraftDirty, useCodeDrafts } from "@/store/code-drafts"
import { useCommands } from "@/store/commands"
import { useSettings } from "@/store/settings"
import { useTabsStore } from "@/store/tabs"
import { useActiveTheme } from "@/store/theme"
import { FileContextBar } from "./provider-card"

interface Props {
  /** API path like "nodes/parse-credentials.ts" */
  path: string
  /** Tab ID so we can update dirty state in the store. */
  tabId: string
}

type Status = "idle" | "saving" | "saved" | "error"

export function CodeEditor({ path, tabId }: Props) {
  const draft = useCodeDrafts((s) => s.drafts[tabId])
  const ownDraft = draft && draft.path === path ? draft : undefined
  const content = ownDraft?.content ?? null
  const dirty = isCodeDraftDirty(ownDraft)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [deletedOnDisk, setDeletedOnDisk] = useState(false)
  const theme = useActiveTheme()
  const fontSize = useSettings((s) => s.editorFontSize)
  const wordWrap = useSettings((s) => s.editorWordWrap)
  const minimap = useSettings((s) => s.editorMinimap)
  const lineNumbers = useSettings((s) => s.editorLineNumbers)
  const setDirty = useTabsStore((s) => s.setDirty)

  useEffect(() => {
    setDirty(tabId, dirty)
  }, [tabId, dirty, setDirty])

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const loadFromDisk = useCallback(() => {
    let alive = true
    setError(null)
    fetchFile(path)
      .then((file) => {
        if (!alive) return
        useCodeDrafts.getState().load(tabId, path, file.content)
        setDeletedOnDisk(false)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [path, tabId])

  // Resume an existing draft (tab switch) instead of re-reading the disk.
  useEffect(() => {
    const existing = useCodeDrafts.getState().drafts[tabId]
    if (existing && existing.path === path) return
    return loadFromDisk()
  }, [loadFromDisk, path, tabId])

  // Live file events: clean drafts reload, dirty drafts get a conflict notice.
  useEffect(() => {
    return subscribeToFileEvents((e) => {
      if (e.path !== path) return
      if (e.type === "unlink") {
        setDeletedOnDisk(true)
        return
      }
      setDeletedOnDisk(false)
      fetchFile(path)
        .then((file) => {
          if (aliveRef.current) useCodeDrafts.getState().externalChange(tabId, file.content)
        })
        .catch(() => {
          // Transient read failure mid-write; the next change event retries.
        })
    })
  }, [path, tabId])

  const save = useCallback(async () => {
    const current = useCodeDrafts.getState().drafts[tabId]
    if (!current) return
    const text = current.content
    setStatus("saving")
    try {
      await saveFile(path, text)
      useCodeDrafts.getState().markSaved(tabId, text)
      setDeletedOnDisk(false)
      if (!aliveRef.current) return
      setStatus("saved")
      setStatusMessage("Saved")
      setTimeout(() => {
        if (aliveRef.current) setStatus((s) => (s === "saved" ? "idle" : s))
      }, 1500)
    } catch (e) {
      if (!aliveRef.current) return
      setStatus("error")
      setStatusMessage((e as Error).message)
    }
  }, [path, tabId])

  // Monaco registers the Ctrl+S command once per mount; route it through a
  // ref so it always saves the current tab's latest text.
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(
    () => useCommands.getState().register({ "file.save": { run: () => void saveRef.current() } }),
    [],
  )

  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveRef.current()
    })
  }

  if (error && content === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-sm font-medium text-destructive">Error loading file: {error}</div>
        <button
          type="button"
          onClick={() => loadFromDisk()}
          className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent"
        >
          Retry
        </button>
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
    <div className="flex h-full w-full flex-col">
      <FileContextBar path={path} />
      <div className="relative min-h-0 flex-1">
        <Editor
          height="100%"
          defaultLanguage={languageFor(path)}
          path={path}
          value={content}
          theme={monacoThemeName(theme)}
          beforeMount={(monaco) => {
            defineMonacoThemes(monaco)
            void setupWorkspaceTypes(monaco)
          }}
          onMount={onMount}
          onChange={(v) => {
            useCodeDrafts.getState().edit(tabId, v ?? "")
          }}
          options={{
            minimap: { enabled: minimap },
            fontSize,
            lineNumbers: lineNumbers ? "on" : "off",
            fontFamily:
              "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: wordWrap ? "on" : "off",
            // Hovers and suggestions escape the editor box instead of being
            // clipped by the tab strip above it.
            fixedOverflowWidgets: true,
          }}
        />
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col items-center gap-2">
          {ownDraft?.diskConflict != null && (
            <EditorNotice
              tone="warning"
              title="This file changed on disk"
              actions={[
                {
                  label: "Reload from disk",
                  onClick: () => useCodeDrafts.getState().resolveConflict(tabId, "disk"),
                },
                {
                  label: "Keep my changes",
                  onClick: () => useCodeDrafts.getState().resolveConflict(tabId, "mine"),
                },
              ]}
            >
              You have unsaved edits. Keeping them overwrites the disk version on your next save.
            </EditorNotice>
          )}
          {deletedOnDisk && (
            <EditorNotice tone="warning" title="This file was deleted on disk">
              Save (Ctrl+S) to recreate it, or close the tab.
            </EditorNotice>
          )}
        </div>
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
    </div>
  )
}

function languageFor(path: string): string {
  if (path.endsWith(".json") || path.endsWith(".workflow")) return "json"
  if (path.endsWith(".md")) return "markdown"
  return "typescript"
}
