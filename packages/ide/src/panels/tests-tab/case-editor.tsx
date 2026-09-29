import type { NodeCase } from "@darrylondil/lorien-runtime/cases"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { type CaseDraft, caseFromDraft } from "./case-drafts"

const area =
  "w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"

export function CaseEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: CaseDraft
  onSave: (c: NodeCase) => Promise<void>
  onCancel: () => void
}) {
  const [d, setD] = useState(initial)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<CaseDraft>) => setD((cur) => ({ ...cur, ...p }))

  const save = async () => {
    const r = caseFromDraft(d)
    if (r.error !== undefined) return setProblem(r.error)
    setProblem(null)
    setSaving(true)
    try {
      await onSave(r.case)
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-md border bg-muted/20 p-2 text-xs"
      data-testid="case-editor"
    >
      <input
        aria-label="Case name"
        placeholder="What should happen, e.g. Rejects a short password"
        className={cn(area, "font-sans text-xs")}
        value={d.name}
        onChange={(e) => set({ name: e.target.value })}
      />
      <label className="flex flex-col gap-0.5">
        <span className="text-muted-foreground">Input</span>
        <textarea
          aria-label="Case input"
          rows={Math.min(10, d.input.split("\n").length + 1)}
          className={area}
          value={d.input}
          onChange={(e) => set({ input: e.target.value })}
        />
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-0.5 text-muted-foreground">Expect</legend>
        <div className="flex gap-3">
          {(
            [
              ["contains", "Output contains"],
              ["equals", "Output equals"],
              ["error", "It throws"],
            ] as const
          ).map(([mode, label]) => (
            <label key={mode} className="flex items-center gap-1">
              <input
                type="radio"
                name={`mode-${d.id}`}
                checked={d.mode === mode}
                onChange={() => set({ mode })}
              />
              {label}
            </label>
          ))}
        </div>
        {d.mode === "error" ? (
          <input
            aria-label="Expected error"
            placeholder="Text the error message contains (empty = any error)"
            className={area}
            value={d.error}
            onChange={(e) => set({ error: e.target.value })}
          />
        ) : (
          <textarea
            aria-label="Expected output"
            placeholder='{ "user": { "email": "ada@example.com" } }  (empty = any output)'
            rows={Math.min(10, Math.max(2, d.output.split("\n").length + 1))}
            className={area}
            value={d.output}
            onChange={(e) => set({ output: e.target.value })}
          />
        )}
      </fieldset>
      <details open={d.mocks.trim().length > 0 || undefined}>
        <summary className="text-muted-foreground">Service mocks</summary>
        <textarea
          aria-label="Service mocks"
          placeholder={
            '{ "db": { "createUser": { "returns": { "id": "u_1" } } } }\nor { "throws": "connection refused" }'
          }
          rows={4}
          className={cn(area, "mt-1")}
          value={d.mocks}
          onChange={(e) => set({ mocks: e.target.value })}
        />
      </details>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-md border bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save case"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 hover:bg-accent">
          Cancel
        </button>
        {problem && (
          <span role="alert" className="text-red-700 dark:text-red-400">
            {problem}
          </span>
        )}
      </div>
    </div>
  )
}
