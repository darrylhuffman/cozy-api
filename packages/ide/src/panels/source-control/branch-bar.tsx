import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Cloud,
  GitBranch,
  GitMerge,
  Plus,
  RefreshCw,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { GitBranch as Branch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useGitStore } from "@/store/git"
import { ago } from "./source-control-panel"

/**
 * The current branch and how it stands against its remote: a menu to switch,
 * create or merge branches, and buttons to fetch, pull and push.
 */
export function BranchBar() {
  const status = useGitStore((s) => s.status)
  const busy = useGitStore((s) => s.busy)
  const syncing = useGitStore((s) => s.syncing)
  if (!status?.repo) return null
  const merging = status.merging !== null

  const iconButton = (
    label: string,
    title: string,
    icon: React.ReactNode,
    onClick: () => void,
    count?: number,
  ) => (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={busy || merging}
      onClick={onClick}
      className="flex h-6 items-center gap-0.5 rounded px-1 font-mono text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-45"
    >
      {icon}
      {count !== undefined && count > 0 && <span>{count}</span>}
    </button>
  )

  return (
    <div className="flex items-center gap-1 px-2 pt-2 pb-1.5">
      <BranchMenu current={status.branch} disabled={busy || merging} />
      <span className="flex-1" />
      {syncing && <span className="text-[11px] text-muted-foreground">{syncing}…</span>}
      {iconButton(
        "Fetch",
        "Fetch from the remote",
        <RefreshCw className={cn("size-3.5", syncing === "Fetching" && "animate-spin")} />,
        () => void useGitStore.getState().fetch(),
      )}
      {status.upstream ? (
        <>
          {iconButton(
            "Pull",
            `Pull ${status.behind} from ${status.upstream}`,
            <ArrowDown className="size-3.5" />,
            () => void useGitStore.getState().pull(),
            status.behind,
          )}
          {iconButton(
            "Push",
            `Push ${status.ahead} to ${status.upstream}`,
            <ArrowUp className="size-3.5" />,
            () => void useGitStore.getState().push(),
            status.ahead,
          )}
        </>
      ) : (
        status.branch &&
        iconButton(
          "Publish branch",
          `Push ${status.branch} to the remote and track it`,
          <Cloud className="size-3.5" />,
          () => void useGitStore.getState().push(),
        )
      )}
    </div>
  )
}

function BranchMenu({ current, disabled }: { current: string | null; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const branches = useGitStore((s) => s.branches)

  useEffect(() => {
    if (open) void useGitStore.getState().loadBranches()
    else setQuery("")
  }, [open])

  const { local, remote } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (b: Branch) => q === "" || b.name.toLowerCase().includes(q)
    const tracked = new Set(branches.filter((b) => !b.remote).map((b) => b.upstream))
    return {
      local: branches.filter((b) => !b.remote && match(b)),
      // A remote branch with a local branch tracking it is reached through that one.
      remote: branches.filter((b) => b.remote && !tracked.has(b.name) && match(b)),
    }
  }, [branches, query])
  const name = query.trim()
  const canCreate = name !== "" && !branches.some((b) => !b.remote && b.name === name)

  const run = async (fn: () => Promise<boolean>) => {
    if (await fn()) setOpen(false)
  }
  const create = () => void run(() => useGitStore.getState().createBranch(name))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Branch ${current ?? "detached HEAD"}. Switch, create or merge branches`}
          className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] hover:bg-accent disabled:opacity-60"
          data-testid="branch-menu"
        >
          <GitBranch aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-mono" data-testid="git-branch">
            {current ?? "detached HEAD"}
          </span>
          <ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] p-0">
        <form
          className="border-b border-border p-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (canCreate) create()
            else if (local[0] && !local[0].current)
              void run(() => useGitStore.getState().switchTo(local[0]!.name))
          }}
        >
          <input
            aria-label="Find or create a branch"
            placeholder="Find or create a branch"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-full rounded-md border border-input bg-background px-2 font-mono text-[12px] focus:border-primary focus:outline-none"
          />
        </form>
        <div className="max-h-[340px] overflow-y-auto p-1 text-[12.5px]">
          {canCreate && (
            <button
              type="button"
              onClick={create}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
            >
              <Plus className="size-3.5 shrink-0 text-primary" />
              <span className="min-w-0 truncate">
                Create <span className="font-mono">{name}</span>
                {current && <span className="text-muted-foreground"> from {current}</span>}
              </span>
            </button>
          )}
          <Heading>Branches</Heading>
          {local.map((b) => (
            <BranchRow
              key={b.name}
              branch={b}
              current={current}
              onSwitch={() => void run(() => useGitStore.getState().switchTo(b.name))}
              onMerge={() => void run(() => useGitStore.getState().merge(b.name))}
            />
          ))}
          {remote.length > 0 && <Heading>Remote</Heading>}
          {remote.map((b) => (
            <BranchRow
              key={b.name}
              branch={b}
              current={current}
              onSwitch={() => void run(() => useGitStore.getState().switchTo(b.name))}
              onMerge={() => void run(() => useGitStore.getState().merge(b.name))}
            />
          ))}
        </div>
        <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          Branches belong to the whole repository, so switching or merging affects every folder in
          it.
        </p>
      </PopoverContent>
    </Popover>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </div>
  )
}

function BranchRow({
  branch: b,
  current,
  onSwitch,
  onMerge,
}: {
  branch: Branch
  current: string | null
  onSwitch: () => void
  onMerge: () => void
}) {
  return (
    <div
      className="group flex items-center gap-1 rounded-md hover:bg-accent"
      data-testid="branch-row"
    >
      <button
        type="button"
        disabled={b.current}
        onClick={onSwitch}
        aria-label={b.current ? `${b.name} (current)` : `Switch to ${b.name}`}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left disabled:cursor-default"
      >
        {b.current ? (
          <Check className="size-3.5 shrink-0 text-primary" />
        ) : b.remote ? (
          <Cloud className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("min-w-0 flex-1 truncate font-mono", b.current && "font-semibold")}>
          {b.name}
        </span>
        {(b.ahead > 0 || b.behind > 0) && (
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
            ↑{b.ahead} ↓{b.behind}
          </span>
        )}
        <span className="shrink-0 text-[10.5px] text-muted-foreground">{ago(b.time)}</span>
      </button>
      {!b.current && current && (
        <button
          type="button"
          aria-label={`Merge ${b.name} into ${current}`}
          title={`Merge ${b.name} into ${current}`}
          onClick={onMerge}
          className="mr-1 rounded p-1 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus:opacity-100 group-hover:opacity-100"
        >
          <GitMerge className="size-3.5" />
        </button>
      )}
    </div>
  )
}
