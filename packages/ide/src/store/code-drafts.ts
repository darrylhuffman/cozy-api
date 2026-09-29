import { create } from "zustand"

/**
 * Unsaved text for each open code tab, kept outside the editor component so
 * switching tabs (which unmounts Monaco) never throws edits away.
 */
export interface CodeDraft {
  path: string
  content: string
  /** Last loaded/saved content — dirty = content differs. */
  baseline: string
  /** Disk content that arrived while the draft had unsaved edits. */
  diskConflict: string | null
}

interface CodeDraftsState {
  drafts: Record<string, CodeDraft>
  load(tabId: string, path: string, content: string): void
  edit(tabId: string, content: string): void
  markSaved(tabId: string, content: string): void
  /** Clean drafts adopt disk content; dirty ones record a conflict. */
  externalChange(tabId: string, content: string): void
  resolveConflict(tabId: string, keep: "disk" | "mine"): void
  drop(tabId: string): void
}

export function isCodeDraftDirty(d: CodeDraft | undefined): boolean {
  return d !== undefined && d.content !== d.baseline
}

export const useCodeDrafts = create<CodeDraftsState>((set, get) => {
  const update = (tabId: string, fn: (d: CodeDraft) => CodeDraft | null): void => {
    const d = get().drafts[tabId]
    if (!d) return
    const next = fn(d)
    if (next) set((s) => ({ drafts: { ...s.drafts, [tabId]: next } }))
  }
  return {
    drafts: {},
    load(tabId, path, content) {
      set((s) => ({
        drafts: {
          ...s.drafts,
          [tabId]: { path, content, baseline: content, diskConflict: null },
        },
      }))
    },
    edit(tabId, content) {
      update(tabId, (d) => (d.content === content ? null : { ...d, content }))
    },
    markSaved(tabId, content) {
      update(tabId, (d) => ({ ...d, content, baseline: content, diskConflict: null }))
    },
    externalChange(tabId, content) {
      update(tabId, (d) => {
        if (content === d.baseline) return null
        if (content === d.content) return { ...d, baseline: content, diskConflict: null }
        if (isCodeDraftDirty(d)) return { ...d, diskConflict: content }
        return { ...d, content, baseline: content }
      })
    },
    resolveConflict(tabId, keep) {
      update(tabId, (d) => {
        if (d.diskConflict === null) return null
        return keep === "disk"
          ? { ...d, content: d.diskConflict, baseline: d.diskConflict, diskConflict: null }
          : { ...d, baseline: d.diskConflict, diskConflict: null }
      })
    },
    drop(tabId) {
      set((s) => {
        if (!s.drafts[tabId]) return s
        const { [tabId]: _removed, ...rest } = s.drafts
        return { drafts: rest }
      })
    },
  }
})
