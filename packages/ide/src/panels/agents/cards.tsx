import { AlertCircle, FileEdit, FileText, Terminal, User } from "lucide-react"
import { useState } from "react"
import Markdown from "react-markdown"
import { splitPrompt } from "@/ai/prompts"
import { cn } from "@/lib/utils"

export function UserMessage({ text }: { text: string }): React.ReactElement {
  // IDE actions send a headline plus a block of context (paths, schemas,
  // errors). Show the headline; fold the context so the chat stays readable.
  const { headline, context } = splitPrompt(text)
  return (
    <div className="flex gap-2 rounded-lg bg-accent/50 px-3 py-2">
      <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          You
        </div>
        <div className="whitespace-pre-wrap text-[13px]">{headline}</div>
        {context && (
          <details className="mt-1 text-[11px] text-muted-foreground">
            <summary>Context sent from the IDE</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[10px]">
              {context}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}

export function AssistantText({ text }: { text: string }): React.ReactElement {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed">
      <Markdown>{text}</Markdown>
    </div>
  )
}

export function ToolUseRead({ path }: { path: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 font-mono text-[11.5px] text-muted-foreground">
      <FileText className="h-3 w-3 shrink-0" />
      <span>Read</span>
      <code className="min-w-0 truncate text-foreground">{path}</code>
    </div>
  )
}

interface ToolUseEditProps {
  path: string
  /** Text the edit replaced (Edit). Absent for a whole-file Write. */
  before?: string | undefined
  /** Text the edit wrote (Edit's new text, or Write's whole content). */
  after?: string | undefined
}

export function ToolUseEdit({ path, before, after }: ToolUseEditProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const hasDiff = before !== undefined || after !== undefined
  return (
    <div className="rounded-md border border-border bg-card text-xs">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <FileEdit className="h-3 w-3 text-info" />
        <span>Edited</span>
        <code className="min-w-0 truncate font-mono text-[11px]">{path}</code>
        {hasDiff && (
          <button
            type="button"
            aria-expanded={open}
            className="ml-auto shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide diff" : "View diff"}
          </button>
        )}
      </div>
      {open && hasDiff && <InlineDiff before={before ?? ""} after={after ?? ""} />}
    </div>
  )
}

/** Before/after lines of an edit: removed lines in red, added in green. */
function InlineDiff({ before, after }: { before: string; after: string }): React.ReactElement {
  const removed = before === "" ? [] : before.split("\n")
  const added = after === "" ? [] : after.split("\n")
  return (
    <pre
      data-testid="edit-diff"
      className="max-h-72 overflow-auto border-t border-border py-1 font-mono text-[11px] leading-[1.6]"
    >
      {removed.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional
        <div key={`-${i}`} className="bg-destructive/10 px-2 text-destructive">
          - {line}
        </div>
      ))}
      {added.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional
        <div key={`+${i}`} className="bg-success/10 px-2 text-success">
          + {line}
        </div>
      ))}
    </pre>
  )
}

interface ToolUseBashProps {
  command: string
  exitCode?: number
}

export function ToolUseBash({ command, exitCode }: ToolUseBashProps): React.ReactElement {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs">
      <Terminal className="h-3 w-3 shrink-0 text-muted-foreground" />
      <code className="flex-1 truncate font-mono text-[11.5px] text-foreground">{command}</code>
      {exitCode !== undefined && (
        <span
          className={cn(
            "font-mono text-[11px]",
            exitCode === 0 ? "text-success" : "text-destructive",
          )}
        >
          exit {exitCode}
        </span>
      )}
    </div>
  )
}

/** An agent error or subprocess exit, shown inline at the end of the chat. */
export function AssistantError({ message }: { message: string }): React.ReactElement {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="max-h-48 flex-1 overflow-y-auto whitespace-pre-wrap font-mono text-[11px]">
        {message}
      </div>
    </div>
  )
}
