import { type KeyboardEvent, type ReactNode, useRef } from "react"
import { cn } from "@/lib/utils"

const TOKEN =
  /("(?:\\.|[^"\\])*"?)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

/** JSON text as spans coloured by token: keys, strings, numbers and literals. */
export function highlightJson(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const [whole, str, colon, literal, num] = m
    if (str !== undefined) {
      out.push(
        <span key={at} className={colon ? "text-info" : "text-success"}>
          {str}
        </span>,
      )
      if (colon) out.push(colon)
    } else if (literal !== undefined) {
      out.push(
        <span key={at} className="text-primary">
          {literal}
        </span>,
      )
    } else if (num !== undefined) {
      out.push(
        <span key={at} className="text-warning">
          {num}
        </span>,
      )
    } else {
      out.push(whole)
    }
    last = at + whole.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const TEXT =
  "m-0 whitespace-pre px-2.5 py-2 font-mono text-[11.5px] leading-[1.6] [tab-size:2] [overflow-wrap:normal]"

interface JsonCodeEditorProps {
  label: string
  value: string
  rows: number
  invalid?: boolean
  onChange: (text: string) => void
}

/**
 * A small JSON editor that works inside the zoomed canvas: a plain textarea
 * over a highlighted copy of its text. Tab indents, Enter keeps the line's
 * indent (one level deeper after `{` or `[`).
 */
export function JsonCodeEditor({ label, value, rows, invalid, onChange }: JsonCodeEditorProps) {
  const backdrop = useRef<HTMLPreElement>(null)

  /** Replaces the selection with `text` and puts the caret after it. */
  const insert = (el: HTMLTextAreaElement, text: string) => {
    const { selectionStart: start, selectionEnd: end } = el
    const next = value.slice(0, start) + text + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + text.length
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    const el = e.currentTarget
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault()
      insert(el, "  ")
    } else if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      const before = value.slice(0, el.selectionStart)
      const line = before.slice(before.lastIndexOf("\n") + 1)
      const indent = line.match(/^\s*/)?.[0] ?? ""
      const opens = /[{[]\s*$/.test(line)
      insert(el, `\n${indent}${opens ? "  " : ""}`)
    }
  }

  return (
    <div
      className={cn(
        "nodrag nopan nowheel relative overflow-hidden rounded-[7px] border border-input bg-background focus-within:border-primary",
        invalid && "border-destructive focus-within:border-destructive",
      )}
    >
      <pre
        ref={backdrop}
        aria-hidden
        className={cn(TEXT, "pointer-events-none absolute inset-0 overflow-hidden text-foreground")}
      >
        {highlightJson(value)}
        {"\n"}
      </pre>
      <textarea
        aria-label={label}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (!backdrop.current) return
          backdrop.current.scrollTop = e.currentTarget.scrollTop
          backdrop.current.scrollLeft = e.currentTarget.scrollLeft
        }}
        className={cn(
          TEXT,
          "relative block w-full resize-none overflow-auto bg-transparent text-transparent caret-foreground outline-none selection:bg-primary/25",
        )}
      />
    </div>
  )
}
