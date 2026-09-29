import { Moon, Plus, Sparkles, Sun } from "lucide-react"
import { useEffect, useState } from "react"
import { showAgents } from "@/ai/ask"
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar"
import { PANE_IDS, PANE_TITLES, type PaneId, reopenPanel } from "@/layout/default-layout"
import { fetchWorkspaceInfo } from "@/lib/api"
import { EnvironmentPicker } from "@/panels/run-tab/environment-picker"
import { type CommandId, runCommand, useCommandEnabled } from "@/store/commands"
import { confirmAction } from "@/store/confirm"
import { useDockviewApi } from "@/store/dockview-api"
import { useThemeStore } from "@/store/theme"
import { MOD } from "@/workflow/shortcuts-dialog"

const LAYOUT_KEY = "lorien-ide-layout"
const TABS_KEY = "lorien-ide-tabs"

export function Topbar() {
  const theme = useThemeStore((s) => s.theme)
  const toggle = useThemeStore((s) => s.toggle)
  const api = useDockviewApi((s) => s.api)
  const [workspace, setWorkspace] = useState<string | null>(null)
  const canAddNode = useCommandEnabled("canvas.addNode")

  useEffect(() => {
    let live = true
    fetchWorkspaceInfo()
      .then((info) => live && setWorkspace(info.name))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

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

  const resetLayout = async () => {
    const confirmed = await confirmAction({
      title: "Reset layout to default?",
      description: "This clears your panel arrangement and open tabs.",
      confirmLabel: "Reset layout",
      destructive: true,
    })
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
    <header className="flex h-11 shrink-0 items-center gap-4 border-b border-border bg-card px-3 text-sm text-foreground">
      {/* Left: logo, workspace, menus */}
      <div className="flex min-w-0 items-center gap-2">
        <LorienMark />
        <span className="select-none text-[15px] font-bold tracking-tight">lorien</span>
        {workspace && (
          <>
            <span className="text-border">/</span>
            <span className="max-w-40 truncate text-[13px] text-muted-foreground" title={workspace}>
              {workspace}
            </span>
          </>
        )}
        <Menubar className="ml-2 h-auto gap-0.5 border-none bg-transparent p-0 shadow-none">
          <MenubarMenu>
            <MenubarTrigger className={TRIGGER}>File</MenubarTrigger>
            <MenubarContent>
              <CommandItem id="file.newWorkflow">New workflow…</CommandItem>
              <CommandItem id="file.newNode">New node…</CommandItem>
              <CommandItem id="file.newFolder">New folder…</CommandItem>
              <MenubarSeparator />
              <CommandItem id="file.save" shortcut={`${MOD}+S`}>
                Save
              </CommandItem>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger className={TRIGGER}>Edit</MenubarTrigger>
            <MenubarContent>
              <CommandItem id="edit.undo" shortcut={`${MOD}+Z`}>
                Undo
              </CommandItem>
              <CommandItem id="edit.redo" shortcut={`${MOD}+Shift+Z`}>
                Redo
              </CommandItem>
              <MenubarSeparator />
              <CommandItem id="canvas.addNode" shortcut={`${MOD}+K`}>
                Add node…
              </CommandItem>
              <CommandItem id="edit.duplicate" shortcut={`${MOD}+D`}>
                Duplicate node
              </CommandItem>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger className={TRIGGER}>View</MenubarTrigger>
            <MenubarContent>
              <CommandItem id="canvas.fitView" shortcut="Shift+1">
                Fit view
              </CommandItem>
              <CommandItem id="canvas.tidy">Tidy layout</CommandItem>
              <MenubarSeparator />
              <MenubarItem className="text-xs" onClick={toggle}>
                {theme === "dark" ? "Light theme" : "Dark theme"}
              </MenubarItem>
              <CommandItem id="help.shortcuts" shortcut="?">
                Keyboard shortcuts
              </CommandItem>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger className={TRIGGER}>Window</MenubarTrigger>
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
              <MenubarItem className="text-xs" onClick={() => void resetLayout()}>
                Reset to default view
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </div>

      {/* Centre: quick add */}
      <button
        type="button"
        onClick={() => runCommand("canvas.addNode")}
        disabled={!canAddNode}
        title={canAddNode ? "Add a node to this workflow" : "Open a workflow to add nodes"}
        className="mx-auto flex h-7 w-full max-w-sm items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-[13px] text-muted-foreground hover:border-input hover:text-foreground disabled:opacity-60 disabled:hover:border-border disabled:hover:text-muted-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Add a node</span>
        <kbd className="rounded border border-input px-1.5 font-mono text-[10.5px]">{MOD}+K</kbd>
      </button>

      {/* Right: environment, agents, theme */}
      <div className="flex items-center gap-2">
        <EnvironmentPicker />
        <button
          type="button"
          onClick={showAgents}
          className="flex h-7 items-center gap-1.5 rounded-lg bg-ai/15 px-2.5 text-[13px] font-medium text-ai hover:bg-ai/25"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Agents
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-label="Toggle theme"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  )
}

const TRIGGER =
  "h-7 px-2 py-0 text-[13px] font-normal text-muted-foreground data-[state=open]:text-foreground"

function CommandItem({
  id,
  shortcut,
  children,
}: {
  id: CommandId
  shortcut?: string
  children: React.ReactNode
}) {
  const enabled = useCommandEnabled(id)
  return (
    <MenubarItem className="text-xs" disabled={!enabled} onClick={() => runCommand(id)}>
      {children}
      {shortcut && <MenubarShortcut>{shortcut}</MenubarShortcut>}
    </MenubarItem>
  )
}

/** The lorien leaf. */
function LorienMark() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
      <path d="M10 2c3.5 3 5 6 5 9a5 5 0 01-10 0c0-3 1.5-6 5-9z" fill="var(--primary)" />
      <path d="M10 7v11" stroke="var(--primary-foreground)" strokeWidth="1.4" fill="none" />
    </svg>
  )
}
