import { create } from "zustand"
import type { WorkflowFile } from "@/lib/api"

/** Max undo steps kept per tab. */
export const HISTORY_LIMIT = 100
/** Edits sharing a coalesce key within this window merge into one undo step. */
export const COALESCE_MS = 1000

/**
 * In-memory editing state for one open workflow tab. Lives outside the
 * editor component so switching tabs (which unmounts the canvas) never throws
 * away unsaved edits or undo history.
 */
export interface WorkflowDraft {
  path: string
  workflow: WorkflowFile
  /** Serialized form of the last loaded/saved workflow — dirty = differs. */
  baseline: string
  past: WorkflowFile[]
  future: WorkflowFile[]
  /** Set when the file changed on disk while this draft had unsaved edits. */
  diskConflict: WorkflowFile | null
  lastCoalesceKey: string | null
  lastEditAt: number
}

export interface ApplyOptions {
  /**
   * Consecutive edits with the same key inside COALESCE_MS collapse into one
   * undo step — e.g. typing into an inline literal field.
   */
  coalesceKey?: string
}

interface DraftsState {
  drafts: Record<string, WorkflowDraft>
  /** Seed (or replace) a tab's draft from freshly-loaded file content. Clears history. */
  load(tabId: string, path: string, workflow: WorkflowFile): void
  /** Record an edit. Pushes the previous state onto the undo stack. */
  apply(tabId: string, workflow: WorkflowFile, opts?: ApplyOptions): void
  undo(tabId: string): boolean
  redo(tabId: string): boolean
  /**
   * `written` reached the disk and becomes the baseline. `source` is the draft
   * state the save was taken from: if the user kept editing while the write was
   * in flight, those newer edits are kept (and the tab stays dirty).
   */
  markSaved(tabId: string, written: WorkflowFile, source?: WorkflowFile): void
  /**
   * The file changed on disk. Clean drafts take the new content as an undoable
   * edit; dirty drafts keep their edits and record a conflict for the user.
   */
  externalChange(tabId: string, workflow: WorkflowFile): void
  /** Resolve a disk conflict: "disk" discards local edits, "mine" keeps them. */
  resolveConflict(tabId: string, keep: "disk" | "mine"): void
  drop(tabId: string): void
}

export function serializeWorkflow(wf: WorkflowFile): string {
  return `${JSON.stringify(wf, null, 2)}\n`
}

export function isDraftDirty(d: WorkflowDraft | undefined): boolean {
  if (!d) return false
  return serializeWorkflow(d.workflow) !== d.baseline
}

export const useWorkflowDrafts = create<DraftsState>((set, get) => {
  const update = (tabId: string, fn: (d: WorkflowDraft) => WorkflowDraft | null): boolean => {
    const d = get().drafts[tabId]
    if (!d) return false
    const next = fn(d)
    if (!next) return false
    set((s) => ({ drafts: { ...s.drafts, [tabId]: next } }))
    return true
  }

  return {
    drafts: {},

    load(tabId, path, workflow) {
      set((s) => ({
        drafts: {
          ...s.drafts,
          [tabId]: {
            path,
            workflow,
            baseline: serializeWorkflow(workflow),
            past: [],
            future: [],
            diskConflict: null,
            lastCoalesceKey: null,
            lastEditAt: 0,
          },
        },
      }))
    },

    apply(tabId, workflow, opts) {
      update(tabId, (d) => {
        if (workflow === d.workflow) return null
        const now = Date.now()
        const coalesce =
          opts?.coalesceKey !== undefined &&
          opts.coalesceKey === d.lastCoalesceKey &&
          now - d.lastEditAt < COALESCE_MS &&
          d.past.length > 0
        const past = coalesce ? d.past : [...d.past, d.workflow].slice(-HISTORY_LIMIT)
        return {
          ...d,
          workflow,
          past,
          future: [],
          lastCoalesceKey: opts?.coalesceKey ?? null,
          lastEditAt: now,
        }
      })
    },

    undo(tabId) {
      return update(tabId, (d) => {
        const prev = d.past[d.past.length - 1]
        if (!prev) return null
        return {
          ...d,
          workflow: prev,
          past: d.past.slice(0, -1),
          future: [d.workflow, ...d.future],
          lastCoalesceKey: null,
        }
      })
    },

    redo(tabId) {
      return update(tabId, (d) => {
        const [nextWf, ...rest] = d.future
        if (!nextWf) return null
        return {
          ...d,
          workflow: nextWf,
          past: [...d.past, d.workflow].slice(-HISTORY_LIMIT),
          future: rest,
          lastCoalesceKey: null,
        }
      })
    },

    markSaved(tabId, written, source) {
      update(tabId, (d) => ({
        ...d,
        workflow: source === undefined || d.workflow === source ? written : d.workflow,
        baseline: serializeWorkflow(written),
        diskConflict: null,
      }))
    },

    externalChange(tabId, workflow) {
      update(tabId, (d) => {
        const incoming = serializeWorkflow(workflow)
        // Our own save echoing back, or a no-op touch.
        if (incoming === d.baseline || incoming === serializeWorkflow(d.workflow)) {
          return incoming === d.baseline ? null : { ...d, baseline: incoming, diskConflict: null }
        }
        if (isDraftDirty(d)) return { ...d, diskConflict: workflow }
        return {
          ...d,
          workflow,
          baseline: incoming,
          past: [...d.past, d.workflow].slice(-HISTORY_LIMIT),
          future: [],
          lastCoalesceKey: null,
        }
      })
    },

    resolveConflict(tabId, keep) {
      update(tabId, (d) => {
        const disk = d.diskConflict
        if (!disk) return null
        if (keep === "mine") {
          // Local edits win; the on-disk version becomes the new baseline so
          // the tab stays dirty until the user saves over it.
          return { ...d, baseline: serializeWorkflow(disk), diskConflict: null }
        }
        return {
          ...d,
          workflow: disk,
          baseline: serializeWorkflow(disk),
          past: [...d.past, d.workflow].slice(-HISTORY_LIMIT),
          future: [],
          diskConflict: null,
          lastCoalesceKey: null,
        }
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
