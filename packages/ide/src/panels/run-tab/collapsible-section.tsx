import { ChevronRight } from "lucide-react"
import { useId, useState } from "react"
import { cn } from "@/lib/utils"

/** A Run tab section whose header opens and closes it; closed until clicked. */
export function CollapsibleSection({
  title,
  count,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string
  count?: number | undefined
  /** Muted text after the title, e.g. "this session". */
  hint?: string | undefined
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className="flex flex-col gap-1.5" aria-label={title}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="-mx-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-accent"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {count !== undefined && (
          <span className="rounded-full bg-muted px-1.5 font-mono text-[10px] leading-4 text-muted-foreground">
            {count}
          </span>
        )}
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </button>
      {open && <div id={id}>{children}</div>}
    </section>
  )
}
