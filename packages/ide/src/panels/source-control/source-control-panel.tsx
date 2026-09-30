import {
  ArrowDown,
  ArrowUp,
  FileCode,
  GitBranch,
  Minus,
  Plus,
  Sparkles,
  Workflow,
} from "lucide-react"
import { useEffect, useState } from "react"
import type { GitCommit, GitFileChange, GitRevision } from "@/lib/api"
import { openDiff } from "@/lib/open-diff"
import { cn } from "@/lib/utils"
import { GIT_LABEL, useGitStore } from "@/store/git"
import { suggestCommitMessage, summarize, workflowDiffFor } from "./summaries"

/**
 * Source Control: what changed since the last commit, staged and not, a
 * commit box, and recent history. Clicking a file opens its diff; workflows
 * open as a visual graph diff.
 */
export function SourceControlPanel() {
  const status = useGitStore((s) => s.status)
  const commits = useGitStore((s) => s.commits)
  const error = useGitStore((s) => s.error)
  const busy = useGitStore((s) => s.busy)
  const [message, setMessage] = useState("")
  const [suggesting, setSuggesting] = useState(false)

  useEffect(() => {
    void useGitStore.getState().refresh()
  }, [])

  if (!status) {
    return (
      <Shell>
        <p className="p-3 text-[12.5px] text-muted-foreground">{error ?? "Reading git status…"}</p>
      </Shell>
    )
  }
  if (!status.repo) {
    return (
      <Shell>
        <p className="p-3 text-[12.5px] text-muted-foreground">
          This workspace isn't in a git repository. Run <code>git init</code> in it to track changes
          here.
        </p>
      </Shell>
    )
  }

  const { staged, changes } = status
  const canCommit = staged.length > 0 && message.trim() !== "" && !busy

  const commit = async () => {
    if (!canCommit) return
    if (await useGitStore.getState().commit(message)) setMessage("")
  }

  const suggest = async () => {
    setSuggesting(true)
    try {
      setMessage(await suggestCommitMessage(staged))
    } finally {
      setSuggesting(false)
    }
  }

  return (
    <Shell>
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-2 text-[12px]">
        <GitBranch aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-mono" data-testid="git-branch">
          {status.branch ?? "detached HEAD"}
        </span>
        {status.upstream && (
          <span
            className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground"
            title={`${status.ahead} to push, ${status.behind} to pull from ${status.upstream}`}
          >
            <ArrowUp aria-hidden className="h-3 w-3" />
            {status.ahead}
            <ArrowDown aria-hidden className="h-3 w-3" />
            {status.behind}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 px-3 pb-3">
        <textarea
          aria-label="Commit message"
          placeholder="Message (Ctrl+Enter to commit)"
          value={message}
          rows={Math.min(Math.max(message.split("\n").length, 2), 8)}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void commit()
            }
          }}
          className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-2 text-[12.5px] outline-none focus:border-primary"
        />
        <button
          type="button"
          disabled={!canCommit}
          onClick={() => void commit()}
          className="h-8 rounded-md bg-primary text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-45"
        >
          {staged.length === 0
            ? "Stage changes to commit"
            : `Commit ${staged.length} ${staged.length === 1 ? "file" : "files"}`}
        </button>
        <button
          type="button"
          disabled={staged.length === 0 || suggesting}
          onClick={() => void suggest()}
          className="flex h-7 items-center justify-center gap-1.5 rounded-md border border-border text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-45"
        >
          <Sparkles aria-hidden className="h-3.5 w-3.5" />
          {suggesting ? "Drafting…" : "Draft message from changes"}
        </button>
        {error && (
          <p role="alert" className="text-[12px] text-destructive">
            {error}
          </p>
        )}
        {status.stagedElsewhere > 0 && (
          <p className="text-[12px] text-warning">
            {status.stagedElsewhere} {status.stagedElsewhere === 1 ? "file is" : "files are"} staged
            outside this workspace. Commit or unstage {status.stagedElsewhere === 1 ? "it" : "them"}{" "}
            first.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileSection
          title="Staged"
          files={staged}
          base="HEAD"
          head="index"
          action={{ label: "Unstage", icon: Minus, run: (p) => useGitStore.getState().unstage(p) }}
        />
        <FileSection
          title="Changes"
          files={changes}
          base="index"
          head="worktree"
          action={{ label: "Stage", icon: Plus, run: (p) => useGitStore.getState().stage(p) }}
        />
        <History commits={commits} />
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-card" data-testid="source-control">
      {children}
    </div>
  )
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="group/section flex h-7 items-center gap-2 px-3 text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
      <span className="flex-1">{children}</span>
      {right}
    </div>
  )
}

function FileSection({
  title,
  files,
  base,
  head,
  action,
}: {
  title: string
  files: GitFileChange[]
  base: GitRevision
  head: GitRevision
  action: { label: string; icon: typeof Plus; run: (paths: string[]) => Promise<void> }
}) {
  if (files.length === 0 && title === "Staged") return null
  const Icon = action.icon
  return (
    <section aria-label={title} className="pb-2">
      <SectionTitle
        right={
          files.length > 0 && (
            <button
              type="button"
              aria-label={`${action.label} all`}
              title={`${action.label} all`}
              onClick={() => void action.run(files.map((f) => f.path))}
              className="rounded p-0.5 opacity-0 hover:bg-accent hover:text-foreground focus:opacity-100 group-hover/section:opacity-100"
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          )
        }
      >
        {title} <span className="ml-1 font-normal">{files.length}</span>
      </SectionTitle>
      {files.length === 0 ? (
        <p className="px-3 text-[12px] text-muted-foreground">No changes since the last commit.</p>
      ) : (
        <ul className="px-1.5">
          {files.map((f) => (
            <FileRow key={f.path} file={f} base={base} head={head} action={action} />
          ))}
        </ul>
      )}
    </section>
  )
}

function FileRow({
  file,
  base,
  head,
  action,
}: {
  file: GitFileChange
  base: GitRevision
  head: GitRevision
  action: { label: string; icon: typeof Plus; run: (paths: string[]) => Promise<void> }
}) {
  const name = file.path.split("/").pop() ?? file.path
  const dir = file.path.split("/").slice(0, -1).join("/")
  const isWorkflow = file.path.endsWith(".workflow")
  const summary = useWorkflowSummary(isWorkflow ? file : null, base, head)
  const label = GIT_LABEL[file.status]
  const Icon = action.icon
  return (
    <li className="group flex items-start gap-1 rounded-md hover:bg-accent">
      <button
        type="button"
        onClick={() => openDiff(file.path, base, head)}
        title={`${file.path}: ${label?.title ?? ""}`}
        className="flex min-w-0 flex-1 items-start gap-2 px-1.5 py-1 text-left"
      >
        {isWorkflow ? (
          <Workflow aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        ) : (
          <FileCode aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
            <span
              className={cn("max-w-full shrink-0 truncate", file.status === "D" && "line-through")}
            >
              {name}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">{dir}</span>
          </span>
          {summary && <span className="truncate text-[11px] text-muted-foreground">{summary}</span>}
        </span>
      </button>
      <button
        type="button"
        aria-label={`${action.label} ${name}`}
        title={action.label}
        onClick={() => void action.run([file.path])}
        className="mt-1 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus:opacity-100 group-hover:opacity-100"
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
      <span
        role="img"
        aria-label={label?.title}
        className={cn(
          "mt-1 mr-1.5 w-3 shrink-0 text-center font-mono text-[11px] font-semibold",
          label?.className,
        )}
      >
        {file.status}
      </span>
    </li>
  )
}

/** "1 node added, 1 changed" for a workflow row, refreshed when git status changes. */
function useWorkflowSummary(
  file: GitFileChange | null,
  base: GitRevision,
  head: GitRevision,
): string | null {
  const status = useGitStore((s) => s.status)
  const [summary, setSummary] = useState<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute whenever git status changes
  useEffect(() => {
    if (!file) return
    let alive = true
    workflowDiffFor(file.path, base, head)
      .then((d) => alive && setSummary(summarize(d) || null))
      .catch(() => alive && setSummary(null))
    return () => {
      alive = false
    }
  }, [file?.path, base, head, status])
  return summary
}

function History({ commits }: { commits: GitCommit[] }) {
  if (commits.length === 0) return null
  return (
    <section aria-label="History" className="pb-3">
      <SectionTitle>History</SectionTitle>
      <ul className="px-3">
        {commits.map((c) => (
          <li
            key={c.hash}
            className="flex items-baseline gap-2 py-0.5 text-[12.5px]"
            title={`${c.subject}\n${c.author}, ${new Date(c.time * 1000).toLocaleString()}`}
          >
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.hash}</span>
            <span className="min-w-0 flex-1 truncate">{c.subject}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{ago(c.time)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** "now", "5m", "3h", "2d", "4w". */
export function ago(seconds: number, now = Date.now() / 1000): string {
  const d = Math.max(0, now - seconds)
  if (d < 60) return "now"
  if (d < 3600) return `${Math.floor(d / 60)}m`
  if (d < 86400) return `${Math.floor(d / 3600)}h`
  if (d < 86400 * 14) return `${Math.floor(d / 86400)}d`
  return `${Math.floor(d / (86400 * 7))}w`
}
