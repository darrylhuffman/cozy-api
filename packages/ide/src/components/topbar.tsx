import { Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"
import {
  Menubar,
  MenubarCheckboxItem,
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
import { PANE_IDS, PANE_TITLES, type PaneId, reopenPanel } from "@/layout/default-layout"
import { useDockviewApi } from "@/store/dockview-api"
import { useThemeStore } from "@/store/theme"

const LAYOUT_KEY = "lorien-ide-layout"
const TABS_KEY = "lorien-ide-tabs"

export function Topbar() {
  const theme = useThemeStore((s) => s.theme)
  const toggle = useThemeStore((s) => s.toggle)
  const api = useDockviewApi((s) => s.api)

  // Re-render the Panes submenu whenever dockview's layout changes
  // so checkbox state stays accurate as panes are opened/closed.
  const [, forceRender] = useState(0)
  useEffect(() => {
    if (!api) return
    const sub = api.onDidLayoutChange(() => forceRender((n) => n + 1))
    return () => sub.dispose()
  }, [api])

  const isPaneOpen = (id: PaneId) => Boolean(api?.getPanel(id))

  const togglePane = (id: PaneId) => {
    if (!api) return
    const panel = api.getPanel(id)
    if (panel) {
      api.removePanel(panel)
    } else {
      reopenPanel(api, id)
    }
  }

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
                  {PANE_IDS.map((id) => (
                    <MenubarCheckboxItem
                      key={id}
                      className="text-xs"
                      checked={isPaneOpen(id)}
                      onSelect={(e) => {
                        // Prevent the menu from closing so the user can toggle multiple
                        e.preventDefault()
                        togglePane(id)
                      }}
                      disabled={!api}
                    >
                      {PANE_TITLES[id]}
                    </MenubarCheckboxItem>
                  ))}
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
