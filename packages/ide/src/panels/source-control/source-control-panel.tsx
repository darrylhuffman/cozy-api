import {
  ChevronDown,
  ExternalLink,
  FileCode,
  GitMerge,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Undo2,
  Workflow,
} from "lucide-react"
import { useEffect, useState } from "react"
import type { GitCommit, GitConflict, GitFileChange, GitRevision, GitStash } from "@/lib/api"
import { openConflict, openDiff } from "@/lib/open-diff"
import { openWorkspaceFile } from "@/lib/open-file"
import { cn } from "@/lib/utils"
import { confirmAction } from "@/store/confirm"
import { GIT_LABEL, useGitStore } from "@/store/git"
import { amendLastCommit, discardFiles, undoLastCommit } from "./actions"
import { BranchBar } from "./branch-bar"
import { ButtonMenu, RowMenu } from "./menus"
import { suggestCommitMessage, summarize, workflowDiffFor } from "./summaries"

/**
 * Source Control: what changed since the last commit, staged and not, a
 * commit box, and recent history. Clicking a file opens its diff; workflows
 * open as a visual graph diff.
 */
export function SourceControlPanel() {
  const status = useGitStore((s) => s.status)
  const commits = useGitStore((s) => s.commits)
  const stashes = useGitStore((s) => s.stashes)
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

  const { staged, changes, conflicts, merging } = status
  const unresolved = conflicts.length + status.conflictsElsewhere
  const draft = message === "" && merging ? merging.message : message
  // Nothing staged: commit every change, as VS Code's smart commit does.
  const commitAll = !merging && staged.length === 0 && changes.length > 0
  const canCommit = merging
    ? unresolved === 0 && draft.trim() !== "" && !busy
    : (staged.length > 0 || commitAll) && message.trim() !== "" && !busy
  const clean = !merging && staged.length === 0 && changes.length === 0
  const git = useGitStore.getState

  const commit = async (then?: "push" | "sync") => {
    if (!canCommit) return
    if (await git().commit(draft, { all: commitAll, then })) setMessage("")
  }
  const amend = async () => {
    if (await amendLastCommit(message)) setMessage("")
  }

  const suggest = async () => {
    setSuggesting(true)
    try {
      setMessage(await suggestCommitMessage(staged.length > 0 ? staged : changes))
    } finally {
      setSuggesting(false)
    }
  }

  const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`
  const commitLabel = merging
    ? "Commit merge"
    : staged.length > 0
      ? `Commit ${count(staged.length, "file")}`
      : commitAll
        ? `Commit all ${count(changes.length, "change")}`
        : "Nothing to commit"
  // With nothing to commit, the button syncs or publishes instead, like VS Code's.
  const syncButton =
    clean && status.upstream && (status.ahead > 0 || status.behind > 0)
      ? {
          label: `Sync changes${status.behind ? ` ↓${status.behind}` : ""}${status.ahead ? ` ↑${status.ahead}` : ""}`,
          run: () => void git().sync(),
        }
      : clean && !status.upstream && status.branch && status.head
        ? { label: "Publish branch", run: () => void git().push() }
        : null

  return (
    <Shell>
      <BranchBar />
      {merging && (
        <div
          className="mx-3 mb-2 flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-[12px]"
          data-testid="merge-banner"
        >
          <div className="flex items-center gap-1.5">
            <GitMerge aria-hidden className="size-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              Merging <span className="font-mono">{merging.branch ?? "changes"}</span>
              {status.branch && (
                <>
                  {" "}
                  into <span className="font-mono">{status.branch}</span>
                </>
              )}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void useGitStore.getState().abortMerge()}
              className="shrink-0 rounded px-1.5 py-0.5 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-45"
            >
              Abort
            </button>
          </div>
          <span className="text-[11.5px] text-muted-foreground">
            {unresolved > 0
              ? `${unresolved} ${unresolved === 1 ? "conflict" : "conflicts"} to resolve, then commit the merge.`
              : "All conflicts resolved. Commit the merge to finish."}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2 px-3 pb-3">
        <textarea
          aria-label="Commit message"
          placeholder="Message (Ctrl+Enter to commit)"
          value={draft}
          rows={Math.min(Math.max(draft.split("\n").length, 2), 8)}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void commit()
            }
          }}
          className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-2 text-[12.5px] outline-none focus:border-primary"
        />
        <div className="flex h-8">
          {syncButton ? (
            <button
              type="button"
              disabled={busy}
              onClick={syncButton.run}
              className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-l-md bg-primary text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-45"
            >
              <RefreshCw aria-hidden className="size-3.5" />
              {syncButton.label}
            </button>
          ) : (
            <button
              type="button"
              disabled={!canCommit}
              onClick={() => void commit()}
              className="min-w-0 flex-1 rounded-l-md bg-primary text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-45"
            >
              {commitLabel}
            </button>
          )}
          <ButtonMenu
            label="Commit options"
            items={[
              { label: commitLabel, run: () => void commit(), disabled: !canCommit },
              {
                label: status.upstream ? "Commit & push" : "Commit & publish",
                run: () => void commit("push"),
                disabled: !canCommit || !status.branch,
              },
              {
                label: "Commit & sync",
                run: () => void commit("sync"),
                disabled: !canCommit || !status.upstream,
              },
              null,
              {
                label:
                  message.trim() === ""
                    ? "Amend last commit (keep its message)"
                    : "Amend last commit",
                run: () => void amend(),
                disabled: busy || !!merging || !status.head,
              },
              {
                label: "Undo last commit",
                run: () => void undoLastCommit(),
                disabled: busy || !!merging || !status.head,
              },
            ]}
            trigger={
              <button
                type="button"
                aria-label="Commit options"
                disabled={busy || !!merging}
                className="flex w-7 items-center justify-center rounded-r-md border-l border-primary-foreground/25 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-45"
              >
                <ChevronDown className="size-3.5" />
              </button>
            }
          />
        </div>
        <button
          type="button"
          disabled={(staged.length === 0 && changes.length === 0) || suggesting}
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
        {status.conflictsElsewhere > 0 && (
          <p className="text-[12px] text-warning">
            {status.conflictsElsewhere} conflicted{" "}
            {status.conflictsElsewhere === 1 ? "file is" : "files are"} outside this workspace.
            Resolve {status.conflictsElsewhere === 1 ? "it" : "them"} in the repository before
            committing.
          </p>
        )}
        {!merging && status.stagedElsewhere > 0 && (
          <p className="text-[12px] text-warning">
            {status.stagedElsewhere} {status.stagedElsewhere === 1 ? "file is" : "files are"} staged
            outside this workspace. Commit or unstage {status.stagedElsewhere === 1 ? "it" : "them"}{" "}
            first.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conflicts.length > 0 && <ConflictSection conflicts={conflicts} />}
        <FileSection title="Staged" files={staged} />
        <FileSection title="Changes" files={changes} />
        <Stashes stashes={stashes} disabled={busy || !!merging} />
        <History commits={commits} head={status.head?.hash ?? null} />
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

type Section = "Staged" | "Changes"

/** Diff bases: staged files compare to the last commit, changes to what's staged. */
const REVS: Record<Section, { base: GitRevision; head: GitRevision }> = {
  Staged: { base: "HEAD", head: "index" },
  Changes: { base: "index", head: "worktree" },
}

function HeaderButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string
  icon: typeof Plus
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded p-0.5 opacity-0 hover:bg-accent hover:text-foreground focus:opacity-100 group-hover/section:opacity-100"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

function FileSection({ title, files }: { title: Section; files: GitFileChange[] }) {
  if (files.length === 0 && title === "Staged") return null
  const git = useGitStore.getState
  const paths = files.map((f) => f.path)
  return (
    <section aria-label={title} className="pb-2">
      <SectionTitle
        right={
          files.length > 0 &&
          (title === "Staged" ? (
            <HeaderButton
              label="Unstage all"
              icon={Minus}
              onClick={() => void git().unstage(paths)}
            />
          ) : (
            <>
              <HeaderButton
                label="Discard all changes"
                icon={Undo2}
                onClick={() => void discardFiles(files)}
              />
              <HeaderButton label="Stage all" icon={Plus} onClick={() => void git().stage(paths)} />
            </>
          ))
        }
      >
        {title} <span className="ml-1 font-normal">{files.length}</span>
      </SectionTitle>
      {files.length === 0 ? (
        <p className="px-3 text-[12px] text-muted-foreground">No changes since the last commit.</p>
      ) : (
        <ul className="px-1.5">
          {files.map((f) => (
            <FileRow key={f.path} file={f} section={title} />
          ))}
        </ul>
      )}
    </section>
  )
}

function RowButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string
  icon: typeof Plus
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label.split(" ")[0] === "Open" ? "Open file" : label.replace(/ \S+$/, "")}
      onClick={onClick}
      className="mt-1 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus:opacity-100 group-hover:opacity-100"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

function FileRow({ file, section }: { file: GitFileChange; section: Section }) {
  const { base, head } = REVS[section]
  const name = file.path.split("/").pop() ?? file.path
  const dir = file.path.split("/").slice(0, -1).join("/")
  const isWorkflow = file.path.endsWith(".workflow")
  const summary = useWorkflowSummary(isWorkflow ? file : null, base, head)
  const label = GIT_LABEL[file.status]
  const git = useGitStore.getState
  // A file deleted on disk has nothing to open.
  const onDisk = !(section === "Changes" && file.status === "D")
  const toggle =
    section === "Staged"
      ? { label: "Unstage", icon: Minus, run: () => void git().unstage([file.path]) }
      : { label: "Stage", icon: Plus, run: () => void git().stage([file.path]) }
  const discardLabel = file.status === "U" ? "Delete file" : "Discard changes"
  return (
    <RowMenu
      label={`${name} actions`}
      items={[
        { label: "Open changes", run: () => openDiff(file.path, base, head) },
        { label: "Open file", run: () => openWorkspaceFile(file.path), disabled: !onDisk },
        null,
        { label: `${toggle.label} changes`, run: toggle.run },
        ...(section === "Changes"
          ? [{ label: `${discardLabel}…`, run: () => void discardFiles([file]), destructive: true }]
          : []),
        null,
        { label: "Copy path", run: () => void navigator.clipboard?.writeText(file.path) },
      ]}
    >
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
                className={cn(
                  "max-w-full shrink-0 truncate",
                  file.status === "D" && "line-through",
                )}
              >
                {name}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">{dir}</span>
            </span>
            {summary && (
              <span className="truncate text-[11px] text-muted-foreground">{summary}</span>
            )}
          </span>
        </button>
        {onDisk && (
          <RowButton
            label={`Open ${name}`}
            icon={ExternalLink}
            onClick={() => openWorkspaceFile(file.path)}
          />
        )}
        {section === "Changes" && (
          <RowButton
            label={`${discardLabel} ${name}`}
            icon={Undo2}
            onClick={() => void discardFiles([file])}
          />
        )}
        <RowButton label={`${toggle.label} ${name}`} icon={toggle.icon} onClick={toggle.run} />
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
    </RowMenu>
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

const SIDE_TEXT: Record<GitConflict["ours"], string> = {
  modified: "changed",
  added: "added",
  deleted: "deleted",
}

function ConflictSection({ conflicts }: { conflicts: GitConflict[] }) {
  return (
    <section aria-label="Conflicts" className="pb-2">
      <SectionTitle>
        Conflicts <span className="ml-1 font-normal">{conflicts.length}</span>
      </SectionTitle>
      <ul className="px-1.5">
        {conflicts.map((c) => {
          const name = c.path.split("/").pop() ?? c.path
          const dir = c.path.split("/").slice(0, -1).join("/")
          const isWorkflow = c.path.endsWith(".workflow")
          return (
            <li key={c.path} className="flex items-start gap-1 rounded-md hover:bg-accent">
              <button
                type="button"
                onClick={() => openConflict(c.path)}
                title={`${c.path}: ours ${SIDE_TEXT[c.ours]}, theirs ${SIDE_TEXT[c.theirs]}`}
                className="flex min-w-0 flex-1 items-start gap-2 px-1.5 py-1 text-left"
              >
                {isWorkflow ? (
                  <Workflow aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <FileCode aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
                    <span className="max-w-full shrink-0 truncate">{name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{dir}</span>
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    Ours {SIDE_TEXT[c.ours]}, theirs {SIDE_TEXT[c.theirs]}
                  </span>
                </span>
              </button>
              <span
                role="img"
                aria-label="Conflict"
                className="mt-1 mr-1.5 w-3 shrink-0 text-center font-mono text-[11px] font-semibold text-destructive"
              >
                C
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Stashes({ stashes, disabled }: { stashes: GitStash[]; disabled: boolean }) {
  if (stashes.length === 0) return null
  const git = useGitStore.getState
  const drop = async (s: GitStash) => {
    const ok = await confirmAction({
      title: "Drop this stash?",
      description: `"${s.message}" is deleted. This can't be undone.`,
      confirmLabel: "Drop stash",
      destructive: true,
    })
    if (ok) await git().stashAction(s.index, "drop")
  }
  return (
    <section aria-label="Stashes" className="pb-2">
      <SectionTitle>
        Stashes <span className="ml-1 font-normal">{stashes.length}</span>
      </SectionTitle>
      <ul className="px-1.5">
        {stashes.map((s) => (
          <RowMenu
            key={s.index}
            label="Stash actions"
            items={[
              { label: "Pop stash", run: () => void git().stashAction(s.index, "pop"), disabled },
              {
                label: "Apply stash",
                run: () => void git().stashAction(s.index, "apply"),
                disabled,
              },
              null,
              { label: "Drop stash…", run: () => void drop(s), disabled, destructive: true },
            ]}
          >
            <li
              className="group flex items-center gap-1 rounded-md py-0.5 pr-1.5 pl-1.5 text-[12.5px] hover:bg-accent"
              title={`${s.message}\n${new Date(s.time * 1000).toLocaleString()}`}
            >
              <span className="min-w-0 flex-1 truncate">{s.message}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground group-hover:hidden">
                {ago(s.time)}
              </span>
              <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex">
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Pop stash ${s.message}`}
                  title="Pop: apply and delete the stash"
                  onClick={() => void git().stashAction(s.index, "pop")}
                  className="rounded px-1 text-[11.5px] text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-45"
                >
                  Pop
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Apply stash ${s.message}`}
                  title="Apply: keep the stash too"
                  onClick={() => void git().stashAction(s.index, "apply")}
                  className="rounded px-1 text-[11.5px] text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-45"
                >
                  Apply
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Drop stash ${s.message}`}
                  title="Drop stash"
                  onClick={() => void drop(s)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-destructive disabled:opacity-45"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            </li>
          </RowMenu>
        ))}
      </ul>
    </section>
  )
}

function History({ commits, head }: { commits: GitCommit[]; head: string | null }) {
  if (commits.length === 0) return null
  return (
    <section aria-label="History" className="pb-3">
      <SectionTitle>History</SectionTitle>
      <ul className="px-1.5">
        {commits.map((c) => (
          <RowMenu
            key={c.hash}
            label="Commit actions"
            items={[
              { label: "Copy commit hash", run: () => void navigator.clipboard?.writeText(c.hash) },
              { label: "Copy message", run: () => void navigator.clipboard?.writeText(c.subject) },
              ...(c.hash === head
                ? [null, { label: "Undo last commit", run: () => void undoLastCommit() }]
                : []),
            ]}
          >
            <li
              className="flex items-baseline gap-2 rounded-md px-1.5 py-0.5 text-[12.5px] hover:bg-accent"
              title={`${c.subject}\n${c.author}, ${new Date(c.time * 1000).toLocaleString()}`}
            >
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.hash}</span>
              <span className="min-w-0 flex-1 truncate">{c.subject}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{ago(c.time)}</span>
            </li>
          </RowMenu>
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
