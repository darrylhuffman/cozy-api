import { Send } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

interface InputBarProps {
  disabled: boolean
  onSend(text: string): void
}

export function InputBar({ disabled, onSend }: InputBarProps): React.ReactElement {
  const [text, setText] = useState("")

  function submit(): void {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText("")
  }

  return (
    <div className="flex shrink-0 items-end gap-2 border-t bg-background p-2">
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
  )
}
