import { AlertCircle, FileEdit, FileText, Terminal, User } from "lucide-react"
import Markdown from "react-markdown"
import { splitPrompt } from "@/ai/prompts"

export function UserMessage({ text }: { text: string }): React.ReactElement {
  // IDE actions send a headline plus a block of context (paths, schemas,
  // errors). Show the headline; fold the context so the chat stays readable.
  const { headline, context } = splitPrompt(text)
  return (
    <div className="flex gap-2 rounded-md bg-muted/30 px-2 py-1.5">
      <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">You</div>
        <div className="whitespace-pre-wrap text-xs">{headline}</div>
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
    <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed">
      <Markdown>{text}</Markdown>
    </div>
  )
}

export function ToolUseRead({ path }: { path: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <FileText className="h-3 w-3" />
      <span>Read</span>
      <code className="rounded bg-muted/40 px-1 font-mono">{path}</code>
    </div>
  )
}

interface ToolUseEditProps {
  path: string
}

export function ToolUseEdit({ path }: ToolUseEditProps): React.ReactElement {
  return (
    <div className="flex items-center gap-2 rounded-sm bg-muted/30 px-2 py-1 text-xs">
      <FileEdit className="h-3 w-3 text-foreground" />
      <span>Edited</span>
      <code className="rounded bg-muted/40 px-1 font-mono">{path}</code>
      <button
        type="button"
        className="ml-auto rounded-sm border border-border bg-background px-2 py-0.5 text-[10px] hover:bg-accent"
        onClick={() => {
          // Diff viewer integration deferred to a follow-up.
          console.info("[lorien] view diff not implemented yet:", path)
        }}
      >
        view diff
      </button>
    </div>
  )
}

interface ToolUseBashProps {
  command: string
  exitCode?: number
}

export function ToolUseBash({ command, exitCode }: ToolUseBashProps): React.ReactElement {
  return (
    <div className="flex items-center gap-2 rounded-sm bg-muted/30 px-2 py-1 text-xs">
      <Terminal className="h-3 w-3" />
      <code className="flex-1 truncate font-mono text-foreground">{command}</code>
      {exitCode !== undefined && (
        <span className={exitCode === 0 ? "text-success" : "text-destructive"}>
          exit {exitCode}
        </span>
      )}
    </div>
  )
}

/**
 * Inline error card. Currently unused — agent errors and subprocess-exit
 * notifications are surfaced via the persistent banner in `ChatView` (driven
 * by `tab.error`). Kept exported for future use when we decide to render
 * errors inline alongside the message stream instead.
 */
export function AssistantError({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex items-start gap-2 rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="flex-1">{message}</div>
    </div>
  )
}
