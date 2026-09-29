import { Sparkles } from "lucide-react"
import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * Toolbar "Ask AI": a one-line question that opens an agent chat with the
 * workflow (and the selected node, when there is one) attached as context.
 */
export function AskAiPopover({
  selectedNodeId,
  onAsk,
}: {
  selectedNodeId: string | null
  onAsk: (question: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const submit = () => {
    const q = text.trim()
    if (!q) return
    onAsk(q)
    setText("")
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Ask AI"
          title="Ask AI about this workflow"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Ask AI</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-2">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="flex flex-col gap-2"
        >
          <textarea
            aria-label="Question for the AI"
            // biome-ignore lint/a11y/noAutofocus: the popover exists to type into
            autoFocus
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="Add a node that emails the user after signup…"
            className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">
              Sends this workflow{selectedNodeId ? ` and node ${selectedNodeId}` : ""} as context
            </span>
            <button
              type="submit"
              disabled={!text.trim()}
              className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Ask
            </button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
