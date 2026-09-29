import { Send } from "lucide-react"
import { useState } from "react"
import { type ContextChip, useContextChips } from "@/ai/context-chips"
import { renderPrompt } from "@/ai/prompts"
import { cn } from "@/lib/utils"

interface InputBarProps {
  disabled: boolean
  onSend(text: string): void
}

export function InputBar({ disabled, onSend }: InputBarProps): React.ReactElement {
  const [text, setText] = useState("")
  const chips = useContextChips()
  // Chips the user toggled away from their default.
  const [flipped, setFlipped] = useState<Set<ContextChip["id"]>>(new Set())
  const isOn = (c: ContextChip) => c.defaultOn !== flipped.has(c.id)

  function submit(): void {
    const trimmed = text.trim()
    if (!trimmed) return
    const context = chips.filter(isOn).map((c) => c.text)
    onSend(renderPrompt({ title: "", headline: trimmed, context }))
    setText("")
  }

  return (
    <div className="flex shrink-0 flex-col gap-1 border-t bg-background p-2">
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" aria-label="Context to include">
          <span className="text-[10px] text-muted-foreground">Include</span>
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={isOn(c)}
              title={
                isOn(c)
                  ? "Sent with your message. Click to leave it out."
                  : "Click to send this with your message."
              }
              onClick={() =>
                setFlipped((cur) => {
                  const next = new Set(cur)
                  if (next.has(c.id)) next.delete(c.id)
                  else next.add(c.id)
                  return next
                })
              }
              className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-[10px]",
                isOn(c)
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground line-through",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          disabled={disabled}
          placeholder="Ask the agent…"
          rows={2}
          className={cn(
            "flex-1 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs",
            disabled && "opacity-50",
          )}
        />
        <button
          type="button"
          aria-label="Send"
          onClick={submit}
          disabled={disabled || text.trim().length === 0}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background",
            (disabled || text.trim().length === 0) && "cursor-not-allowed opacity-50",
          )}
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
