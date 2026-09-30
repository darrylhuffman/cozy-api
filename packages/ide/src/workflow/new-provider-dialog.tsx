import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { FileFolder } from "@/data/mock-files"
import { createWorkspaceFile, type ProviderLifetime } from "@/lib/api"
import { cn } from "@/lib/utils"
import { LIFETIME_HELP, useProvidersStore } from "@/store/providers"
import { FolderPicker } from "./folder-picker"
import { providerTemplate, SELECTOR_PATTERN, selectorRead } from "./provider-template"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new file's path, e.g. "providers/db.ts". */
  onCreated: (path: string) => void
  /** Folder to create it in, e.g. "providers/aws". */
  defaultFolder?: string
  /** The providers tree, to pick another folder. */
  providersTree?: FileFolder
}

const LIFETIMES: { value: ProviderLifetime; label: string }[] = [
  { value: "singleton", label: "Singleton" },
  { value: "scoped", label: "Scoped" },
  { value: "transient", label: "Transient" },
]

/**
 * Creates `<folder>/<selector>.ts`: a database, logger or client every node
 * can read by its selector.
 */
export function NewProviderDialog({
  open,
  onOpenChange,
  onCreated,
  defaultFolder = "providers",
  providersTree,
}: Props) {
  const [name, setName] = useState("")
  const [folder, setFolder] = useState(defaultFolder)
  const [lifetime, setLifetime] = useState<ProviderLifetime>("singleton")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName("")
      setFolder(defaultFolder)
      setLifetime("singleton")
      setError(null)
    }
  }, [open, defaultFolder])

  const selector = name.trim()
  const valid = SELECTOR_PATTERN.test(selector)
  const taken = useProvidersStore((s) => s.providers.find((p) => p.name === selector))

  async function handleCreate() {
    setError(null)
    if (!valid) {
      setError("Start with a letter, then use letters, digits, - or _")
      return
    }
    if (taken) {
      setError(`${taken.path} already uses this selector`)
      return
    }
    const path = `${folder}/${selector}.ts`
    try {
      await createWorkspaceFile(path, providerTemplate(selector, lifetime))
      onOpenChange(false)
      onCreated(path)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New provider</DialogTitle>
        </DialogHeader>
        <p className="-mt-1 text-xs text-muted-foreground">
          A database, logger or client that every node can read. It holds setup, not business logic.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleCreate()
          }}
        >
          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="new-provider-name" className="text-xs text-muted-foreground">
                Selector
              </label>
              <input
                id="new-provider-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="db"
                autoFocus
                spellCheck={false}
                className="w-full rounded-md border border-input bg-transparent px-2 py-1 font-mono text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
              />
              <div className="text-xs text-muted-foreground">
                {valid ? (
                  <>
                    Nodes read it as{" "}
                    <code className="font-mono text-foreground">{selectorRead(selector)}</code>
                    {selector.includes("-") && ". camelCase reads without quotes"}
                    {taken && (
                      <span className="text-destructive">, but {taken.path} already uses it</span>
                    )}
                  </>
                ) : (
                  "The name nodes read it by: letters, digits, - or _, starting with a letter"
                )}
              </div>
            </div>
            {providersTree && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Folder</div>
                <FolderPicker root={providersTree} value={folder} onChange={setFolder} />
              </div>
            )}
            {valid && (
              <div className="text-xs text-muted-foreground">
                Creates{" "}
                <code className="font-mono text-foreground">
                  {folder}/{selector}.ts
                </code>
              </div>
            )}
            <fieldset className="space-y-1">
              <legend className="mb-1 text-xs text-muted-foreground">Lifetime</legend>
              <div className="flex gap-1">
                {LIFETIMES.map((l) => (
                  <label
                    key={l.value}
                    className={cn(
                      "flex-1 cursor-pointer rounded-md border border-input px-2 py-1 text-center text-sm hover:bg-accent has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring",
                      lifetime === l.value && "border-primary bg-primary/10 text-foreground",
                    )}
                  >
                    <input
                      type="radio"
                      name="provider-lifetime"
                      value={l.value}
                      checked={lifetime === l.value}
                      onChange={() => setLifetime(l.value)}
                      className="sr-only"
                    />
                    {l.label}
                  </label>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">{LIFETIME_HELP[lifetime]}</div>
            </fieldset>
            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded px-3 py-1.5 text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={selector.length === 0}
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
