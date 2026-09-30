import { ContextMenu, DropdownMenu } from "radix-ui"
import { cn } from "@/lib/utils"

/** One entry in a Source Control menu; `null` draws a separator. */
export type MenuEntry = {
  label: string
  run: () => void
  disabled?: boolean
  destructive?: boolean
} | null

const CONTENT =
  "z-50 min-w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
const ITEM =
  "flex cursor-default items-center rounded-sm px-2 py-1.5 text-[12.5px] outline-none select-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-50"
const SEPARATOR = "my-1 h-px bg-border"

function entries(list: MenuEntry[]): MenuEntry[] {
  // No leading, trailing or doubled separators after items are filtered out.
  return list.filter(
    (e, i, all) => e !== null || (i > 0 && i < all.length - 1 && all[i - 1] !== null),
  )
}

/** Right-click menu around `children`. */
export function RowMenu({
  label,
  items,
  children,
}: {
  label: string
  items: MenuEntry[]
  children: React.ReactNode
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content aria-label={label} className={CONTENT}>
          {entries(items).map((e, i) =>
            e === null ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
              <ContextMenu.Separator key={i} className={SEPARATOR} />
            ) : (
              <ContextMenu.Item
                key={e.label}
                disabled={e.disabled ?? false}
                onSelect={e.run}
                className={cn(ITEM, e.destructive && "text-destructive")}
              >
                {e.label}
              </ContextMenu.Item>
            ),
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

/** A button that opens a menu of `items`. */
export function ButtonMenu({
  label,
  items,
  trigger,
  align = "end",
}: {
  label: string
  items: MenuEntry[]
  trigger: React.ReactNode
  align?: "start" | "end"
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content aria-label={label} align={align} sideOffset={4} className={CONTENT}>
          {entries(items).map((e, i) =>
            e === null ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
              <DropdownMenu.Separator key={i} className={SEPARATOR} />
            ) : (
              <DropdownMenu.Item
                key={e.label}
                disabled={e.disabled ?? false}
                onSelect={e.run}
                className={cn(ITEM, e.destructive && "text-destructive")}
              >
                {e.label}
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
