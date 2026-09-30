import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { createWorkspaceFile, type ProviderLifetime } from "@/lib/api"
import { cn } from "@/lib/utils"
import { LIFETIME_HELP } from "@/store/providers"
import { providerName, providerTemplate } from "./provider-template"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new file's path, e.g. "providers/db.ts". */
  onCreated: (path: string) => void
}

const LIFETIMES: { value: ProviderLifetime; label: string }[] = [
  { value: "singleton", label: "Singleton" },
  { value: "scoped", label: "Scoped" },
  { value: "transient", label: "Transient" },
]

/** Creates `providers/<name>.ts`: a database, logger or client every node can read. */
export function NewProviderDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState("")
  const [lifetime, setLifetime] = useState<ProviderLifetime>("singleton")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName("")
      setLifetime("singleton")
      setError(null)
    }
  }, [open])

  const bare = name.trim().replace(/\.ts$/, "")
  const valid = /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(bare)

  async function handleCreate() {
    setError(null)
    if (!valid) {
      setError("Use letters, numbers, - or _, starting with a letter")
      return
    }
    const path = `providers/${bare}.ts`
    try {
      await createWorkspaceFile(path, providerTemplate(bare, lifetime))
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
                Name
              </label>
              <div className="flex items-stretch overflow-hidden rounded-md border border-input bg-transparent focus-within:ring-1 focus-within:ring-ring">
                <span className="flex select-none items-center bg-muted px-2 py-1 text-sm text-muted-foreground">
                  providers/
                </span>
                <input
                  id="new-provider-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="db"
                  autoFocus
                  className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
                />
                <span className="flex select-none items-center bg-muted px-2 py-1 text-sm text-muted-foreground">
                  .ts
                </span>
              </div>
              {valid && (
                <div className="text-xs text-muted-foreground">
                  Nodes read it as{" "}
                  <code className="font-mono text-foreground">{providerName(bare)}</code>
                </div>
              )}
            </div>
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
              disabled={bare.length === 0}
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
