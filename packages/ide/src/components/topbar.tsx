import { Moon, Sun } from "lucide-react"
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar"
import { cn } from "@/lib/utils"
import { useThemeStore } from "@/store/theme"

const LAYOUT_KEY = "lorien-ide-layout"
const TABS_KEY = "lorien-ide-tabs"

export function Topbar() {
  const theme = useThemeStore((s) => s.theme)
  const toggle = useThemeStore((s) => s.toggle)

  const resetLayout = () => {
    const confirmed = window.confirm(
      "Reset layout to default?\nThis will clear your panel arrangement and open tabs.",
    )
    if (!confirmed) return
    try {
      localStorage.removeItem(LAYOUT_KEY)
      localStorage.removeItem(TABS_KEY)
    } catch {
      // ignore
    }
    window.location.reload()
  }

  return (
    <div
      className={cn(
        "flex h-8 shrink-0 items-center justify-between border-b bg-background px-2",
        "text-sm text-foreground",
      )}
    >
      {/* Left: logo + menus */}
      <div className="flex items-center gap-2">
        <span className="select-none font-semibold tracking-tight text-primary">lorien</span>
        <Menubar className="h-auto border-none bg-transparent p-0 shadow-none">
          <MenubarMenu>
            <MenubarTrigger className="h-6 px-2 py-0.5 text-xs">Window</MenubarTrigger>
            <MenubarContent>
              <MenubarSub>
                <MenubarSubTrigger className="text-xs">Panes</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem className="text-xs" disabled>
                    Files
                  </MenubarItem>
                  <MenubarItem className="text-xs" disabled>
                    Editor
                  </MenubarItem>
                  <MenubarItem className="text-xs" disabled>
                    Inspector
                  </MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSeparator />
              <MenubarItem className="text-xs" onClick={resetLayout}>
                Reset to default view
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </div>

      {/* Right: dark mode toggle */}
      <button
        type="button"
        onClick={toggle}
        aria-label="Toggle theme"
        className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
