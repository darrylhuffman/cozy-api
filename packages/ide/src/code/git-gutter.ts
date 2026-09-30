import type { OnMount } from "@monaco-editor/react"
import { useEffect, useState } from "react"
import { fetchGitFile } from "@/lib/api"
import { diffLines, hunkKind } from "@/lib/line-diff"
import { openDiff } from "@/lib/open-diff"
import { useGitStore } from "@/store/git"

type Editor = Parameters<OnMount>[0]
type Monaco = Parameters<OnMount>[1]

/** Recompute after typing pauses this long. */
const DEBOUNCE_MS = 250

/**
 * VS Code's change marks: bars in the gutter where the editor's text differs
 * from what's staged (green added, blue changed, a red wedge where lines were
 * removed). Clicking one opens the file's changes.
 */
export function useGitGutter(
  editor: Editor | null,
  monaco: Monaco | null,
  path: string,
  content: string | null,
): void {
  const status = useGitStore((s) => s.status)
  const change = status?.repo ? status.changes.find((c) => c.path === path) : undefined
  const staged = status?.repo ? status.staged.some((c) => c.path === path) : false
  // What the editor is compared with: the staged text, "" for a new file, or
  // null when the file matches it on disk (no marks unless edited since).
  const [base, setBase] = useState<string | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read whenever git status changes
  useEffect(() => {
    if (!status?.repo) {
      setBase(null)
      return
    }
    let alive = true
    fetchGitFile(path, "index")
      .then((text) => alive && setBase(text ?? (change?.status === "U" ? "" : null)))
      .catch(() => alive && setBase(null))
    return () => {
      alive = false
    }
  }, [path, status, change?.status, staged])

  useEffect(() => {
    if (!editor || !monaco) return
    const decorations = editor.createDecorationsCollection()
    const timer = setTimeout(() => {
      if (base === null || content === null) return
      decorations.set(
        diffLines(base, content).map((h) => {
          const kind = hunkKind(h)
          const start = kind === "removed" ? Math.max(1, h.headStart) : h.headStart + 1
          const end = kind === "removed" ? start : h.headEnd
          return {
            range: new monaco.Range(start, 1, end, 1),
            options: {
              linesDecorationsClassName: `git-gutter git-gutter-${kind}${kind === "removed" && h.headStart === 0 ? " git-gutter-top" : ""}`,
            },
          }
        }),
      )
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      decorations.clear()
    }
  }, [editor, monaco, base, content])

  useEffect(() => {
    if (!editor || !monaco) return
    const sub = editor.onMouseDown((e) => {
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS) return
      if (!(e.target.element as HTMLElement | null)?.classList.contains("git-gutter")) return
      openDiff(path, "index", "worktree")
    })
    return () => sub.dispose()
  }, [editor, monaco, path])
}
