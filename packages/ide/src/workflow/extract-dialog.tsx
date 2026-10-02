import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { type ExtractionPlan, type ExtractOptions, subworkflowPathFor } from "./extract-subworkflow"
import { invalidPortName } from "./subworkflow"

interface Props {
  /** What extracting the selection would do; null keeps the dialog closed. */
  plan: ExtractionPlan | null
  onOpenChange: (open: boolean) => void
  /** Extracts with the picked name, folder and port names; resolves to an error message, or null. */
  onExtract: (opts: ExtractOptions) => Promise<string | null>
  /** True when a workspace file (or node) already takes this path. */
  exists?: (path: string) => boolean
}

const FIELD =
  "h-7 min-w-0 rounded-md border border-input bg-transparent px-2 font-mono text-xs outline-none focus:border-primary"

/**
 * Confirms a move of the selected nodes into a new sub-workflow: its name and
 * folder, what its inputs and outputs will be called, and anything about how
 * it runs that changes. Refusals (a trigger in the selection, a node in the
 * middle of it) show here instead.
 */
export function ExtractDialog({ plan, onOpenChange, onExtract, exists }: Props) {
  const [name, setName] = useState("")
  const [folder, setFolder] = useState("")
  const [inputNames, setInputNames] = useState<string[]>([])
  const [outputNames, setOutputNames] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!plan) return
    setName(plan.name)
    setFolder(plan.folder)
    setInputNames(plan.inputs.map((i) => i.name))
    setOutputNames(plan.outputs.map((o) => o.name))
    setError(null)
    setBusy(false)
  }, [plan])

  if (!plan) return null
  const blocked = plan.errors.length > 0
  const portProblem = (names: string[], k: number) =>
    invalidPortName(names[k] ?? "") ??
    (names.indexOf(names[k] ?? "") !== k ? "Already used by another port" : null)
  const invalid =
    !name.trim() ||
    inputNames.some((_, k) => portProblem(inputNames, k)) ||
    outputNames.some((_, k) => portProblem(outputNames, k))
  const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, "") || "shared"

  async function submit() {
    if (blocked || invalid || busy) return
    setBusy(true)
    const problem = await onExtract({
      name: name.trim(),
      folder: cleanFolder,
      inputNames,
      outputNames,
    })
    setBusy(false)
    if (problem) setError(problem)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="extract-dialog">
        <DialogHeader>
          <DialogTitle>Move to a new sub-workflow</DialogTitle>
        </DialogHeader>
        {blocked ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              These {plan.nodeIds.length} nodes can't move into a sub-workflow yet:
            </p>
            <ul className="flex list-disc flex-col gap-1.5 pl-5">
              {plan.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded px-3 py-1.5 text-sm hover:bg-accent"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
            className="flex flex-col gap-4 text-sm"
          >
            <p className="-mt-1 text-xs text-muted-foreground">
              The {plan.nodeIds.length} selected nodes move into their own file, and one node takes
              their place here, wired the same way. You can undo the change here; the new file
              stays.
            </p>
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
              <label htmlFor="extract-name" className="text-xs text-muted-foreground">
                Name
              </label>
              <input
                id="extract-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className={cn(FIELD, "font-sans text-sm")}
              />
              <label htmlFor="extract-folder" className="text-xs text-muted-foreground">
                Folder
              </label>
              <div className="flex min-w-0 items-stretch overflow-hidden rounded-md border border-input focus-within:border-primary">
                <span className="flex select-none items-center bg-muted px-2 font-mono text-xs text-muted-foreground">
                  nodes/
                </span>
                <input
                  id="extract-folder"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  className="h-7 min-w-0 flex-1 bg-transparent px-2 font-mono text-xs outline-none"
                />
              </div>
              <span />
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {subworkflowPathFor(name, cleanFolder, exists)}
              </span>
            </div>

            <PortList
              title="Inputs"
              empty="None: it reads nothing from the rest of the workflow."
              rows={plan.inputs.map((i) => ({ hint: `${i.type} from ${i.source}` }))}
              names={inputNames}
              setNames={setInputNames}
              problem={(k) => portProblem(inputNames, k)}
            />
            <PortList
              title="Outputs"
              empty="None: nothing after it reads its values."
              rows={plan.outputs.map((o) => ({ hint: o.source }))}
              names={outputNames}
              setNames={setOutputNames}
              problem={(k) => portProblem(outputNames, k)}
            />

            {(plan.when || plan.after.length > 0 || plan.notes.length > 0) && (
              <ul className="flex flex-col gap-1.5 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {plan.when && (
                  <li>
                    The new node runs only when <code className="font-mono">{plan.when}</code>, as
                    its first nodes did.
                  </li>
                )}
                {plan.after.length > 0 && <li>It waits for {plan.after.join(", ")}.</li>}
                {plan.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}

            {error && <div className="text-sm text-destructive">{error}</div>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded px-3 py-1.5 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={invalid || busy}
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
              >
                Move to sub-workflow
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PortList({
  title,
  empty,
  rows,
  names,
  setNames,
  problem,
}: {
  title: string
  empty: string
  rows: Array<{ hint: string }>
  names: string[]
  setNames: (names: string[]) => void
  problem: (k: number) => string | null
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">{empty}</p>}
      {rows.map((row, k) => {
        const p = problem(k)
        return (
          <div key={row.hint} className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
            <input
              aria-label={`${title.slice(0, -1)} name for ${row.hint}`}
              value={names[k] ?? ""}
              title={p ?? undefined}
              spellCheck={false}
              onChange={(e) => setNames(names.map((n, i) => (i === k ? e.target.value.trim() : n)))}
              className={cn(FIELD, p && "border-destructive focus:border-destructive")}
            />
            <span className="truncate font-mono text-[11px] text-muted-foreground" title={row.hint}>
              {row.hint}
            </span>
          </div>
        )
      })}
    </section>
  )
}
