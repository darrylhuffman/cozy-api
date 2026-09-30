import { Check, Code2, Minus, Palette, Plus, Workflow } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { THEMES, type ThemeDef, type ThemeId } from "@/lib/themes"
import { cn } from "@/lib/utils"
import {
  type CanvasBackground,
  EDITOR_FONT_SIZES,
  openSettings,
  useSettings,
  useSettingsDialog,
} from "@/store/settings"
import { useActiveTheme, useThemeStore } from "@/store/theme"
import { MOD } from "@/workflow/shortcuts-dialog"

type Section = "appearance" | "editor" | "canvas"

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Palette }> = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "editor", label: "Code editor", icon: Code2 },
  { id: "canvas", label: "Canvas", icon: Workflow },
]

/** Mounted once in App: the Settings dialog plus its Ctrl+, shortcut. */
export function SettingsDialogHost() {
  const open = useSettingsDialog((s) => s.open)
  const setOpen = useSettingsDialog((s) => s.setOpen)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault()
        openSettings()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  return <SettingsDialog open={open} onOpenChange={setOpen} />
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [section, setSection] = useState<Section>("appearance")
  const reset = useSettings((s) => s.reset)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(600px,calc(100vh-4rem))] gap-0 overflow-hidden bg-card p-0 sm:max-w-3xl">
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-border bg-background p-3">
          <DialogTitle className="px-2 pt-1 pb-3 text-sm">Settings</DialogTitle>
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              aria-current={section === id ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground",
                section === id && "bg-accent text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
          <div className="mt-auto px-2 text-[11px] text-muted-foreground">
            <kbd className="font-mono">{MOD}+,</kbd> opens this anywhere
          </div>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <DialogDescription className="sr-only">
            Theme, code editor and canvas preferences. Changes apply right away.
          </DialogDescription>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-6">
            {section === "appearance" && <AppearanceSection />}
            {section === "editor" && <EditorSection />}
            {section === "canvas" && <CanvasSection />}
          </div>
          {section !== "appearance" && (
            <div className="flex justify-end border-t border-border px-6 py-3">
              <button
                type="button"
                onClick={reset}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Restore defaults
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AppearanceSection() {
  const choice = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const active = useActiveTheme()
  const dark = THEMES.filter((t) => t.mode === "dark")
  const light = THEMES.filter((t) => t.mode === "light")

  const pick = (t: ThemeDef) => setTheme(t.id as ThemeId)

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Theme"
        description="Colours for the whole IDE: panels, the workflow canvas and the code editor."
      />
      <SettingRow
        label="Match system"
        description="Use Lorien Dark or Lorien Light to follow your OS setting."
      >
        <Toggle
          label="Match system"
          checked={choice === "system"}
          onChange={(on) => setTheme(on ? "system" : (active.id as ThemeId))}
        />
      </SettingRow>
      <ThemeGroup title="Dark" themes={dark} activeId={active.id} onPick={pick} />
      <ThemeGroup title="Light" themes={light} activeId={active.id} onPick={pick} />
    </div>
  )
}

function ThemeGroup({
  title,
  themes,
  activeId,
  onPick,
}: {
  title: string
  themes: readonly ThemeDef[]
  activeId: string
  onPick: (t: ThemeDef) => void
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </div>
      <div role="radiogroup" aria-label={`${title} themes`} className="grid grid-cols-3 gap-3">
        {themes.map((t) => (
          <ThemeCard key={t.id} theme={t} selected={t.id === activeId} onPick={() => onPick(t)} />
        ))}
      </div>
    </div>
  )
}

function ThemeCard({
  theme,
  selected,
  onPick,
}: {
  theme: ThemeDef
  selected: boolean
  onPick: () => void
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a card-shaped radio reads better than a native input here
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={theme.label}
      onClick={onPick}
      className={cn(
        "group flex flex-col gap-2 rounded-lg p-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-accent ring-2 ring-primary",
      )}
    >
      <ThemePreview theme={theme} />
      <div className="flex items-center gap-1.5 px-1 pb-0.5">
        <span className="truncate text-[13px] font-medium">{theme.label}</span>
        {selected && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />}
      </div>
    </button>
  )
}

/** A miniature IDE drawn in the theme's own colours: panel, canvas with two nodes, code. */
function ThemePreview({ theme }: { theme: ThemeDef }) {
  const p = theme.palette
  const s = theme.syntax ?? {
    keyword: p.ai,
    type: p.info,
    string: p.success,
    comment: p.mutedForeground,
  }
  const node = {
    background: p.card,
    border: `1px solid ${p.input}`,
  }
  return (
    <div
      aria-hidden
      className="relative h-[84px] w-full overflow-hidden rounded-md"
      style={{ background: p.background, boxShadow: `inset 0 0 0 1px ${p.border}` }}
    >
      <div
        className="absolute inset-x-0 top-0 h-2.5"
        style={{ background: p.card, borderBottom: `1px solid ${p.border}` }}
      />
      <div
        className="absolute top-2.5 bottom-0 left-0 flex w-[26%] flex-col gap-1 p-1.5"
        style={{ background: p.card, borderRight: `1px solid ${p.border}` }}
      >
        <div className="h-1 w-4/5 rounded-full" style={{ background: p.mutedForeground }} />
        <div className="h-1 w-3/5 rounded-full" style={{ background: p.primary }} />
        <div className="h-1 w-2/3 rounded-full" style={{ background: p.mutedForeground }} />
      </div>
      <svg
        className="absolute top-2.5 left-[26%] h-[44px] w-[74%]"
        viewBox="0 0 100 44"
        preserveAspectRatio="none"
      >
        <title>{theme.label}</title>
        <path
          d="M 30 16 C 45 16, 45 30, 60 30"
          fill="none"
          stroke={p.mutedForeground}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="absolute top-[18px] left-[32%] h-3 w-[16%] rounded-sm" style={node}>
        <div className="m-[3px] h-1 w-1 rounded-full" style={{ background: p.success }} />
      </div>
      <div className="absolute top-[32px] left-[66%] h-3 w-[16%] rounded-sm" style={node}>
        <div className="m-[3px] h-1 w-1 rounded-full" style={{ background: p.primary }} />
      </div>
      <div
        className="absolute right-0 bottom-0 left-[26%] flex flex-col gap-1 px-2 py-1.5"
        style={{ borderTop: `1px solid ${p.border}` }}
      >
        <div className="flex gap-1">
          <Token color={s.keyword} w={14} />
          <Token color={s.type} w={20} />
          <Token color={p.foreground} w={8} />
          <Token color={s.string} w={22} />
        </div>
        <div className="flex gap-1">
          <Token color={s.comment} w={40} />
        </div>
      </div>
    </div>
  )
}

function Token({ color, w }: { color: string; w: number }) {
  return <div className="h-1 rounded-full" style={{ background: color, width: `${w}%` }} />
}

function EditorSection() {
  const fontSize = useSettings((s) => s.editorFontSize)
  const wordWrap = useSettings((s) => s.editorWordWrap)
  const minimap = useSettings((s) => s.editorMinimap)
  const lineNumbers = useSettings((s) => s.editorLineNumbers)
  const update = useSettings((s) => s.update)
  const idx = EDITOR_FONT_SIZES.indexOf(fontSize as (typeof EDITOR_FONT_SIZES)[number])

  const step = (dir: 1 | -1) => {
    const next = EDITOR_FONT_SIZES[Math.min(EDITOR_FONT_SIZES.length - 1, Math.max(0, idx + dir))]
    if (next !== undefined) update({ editorFontSize: next })
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Code editor"
        description="Applies to node source files and request bodies in the Run tab."
      />
      <div className="divide-y divide-border">
        <SettingRow label="Font size">
          <div className="flex items-center rounded-md border border-input">
            <StepButton label="Smaller font" disabled={idx <= 0} onClick={() => step(-1)}>
              <Minus className="h-3 w-3" />
            </StepButton>
            <span className="w-10 text-center font-mono text-xs tabular-nums" aria-live="polite">
              {fontSize}px
            </span>
            <StepButton
              label="Larger font"
              disabled={idx >= EDITOR_FONT_SIZES.length - 1}
              onClick={() => step(1)}
            >
              <Plus className="h-3 w-3" />
            </StepButton>
          </div>
        </SettingRow>
        <SettingRow label="Word wrap" description="Wrap long lines instead of scrolling sideways.">
          <Toggle
            label="Word wrap"
            checked={wordWrap}
            onChange={(v) => update({ editorWordWrap: v })}
          />
        </SettingRow>
        <SettingRow label="Line numbers">
          <Toggle
            label="Line numbers"
            checked={lineNumbers}
            onChange={(v) => update({ editorLineNumbers: v })}
          />
        </SettingRow>
        <SettingRow label="Minimap" description="Code overview along the right edge.">
          <Toggle
            label="Minimap"
            checked={minimap}
            onChange={(v) => update({ editorMinimap: v })}
          />
        </SettingRow>
      </div>
    </div>
  )
}

const BACKGROUNDS: Array<{ id: CanvasBackground; label: string }> = [
  { id: "dots", label: "Dots" },
  { id: "lines", label: "Grid" },
  { id: "none", label: "Plain" },
]

function CanvasSection() {
  const background = useSettings((s) => s.canvasBackground)
  const minimap = useSettings((s) => s.canvasMinimap)
  const snap = useSettings((s) => s.canvasSnapToGrid)
  const update = useSettings((s) => s.update)

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Canvas" description="How the workflow canvas looks and behaves." />
      <div className="divide-y divide-border">
        <SettingRow label="Background">
          <div
            role="radiogroup"
            aria-label="Canvas background"
            className="flex rounded-md bg-muted p-0.5"
          >
            {BACKGROUNDS.map((b) => (
              // biome-ignore lint/a11y/useSemanticElements: segmented control
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={background === b.id}
                onClick={() => update({ canvasBackground: b.id })}
                className={cn(
                  "rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground",
                  background === b.id && "bg-card text-foreground shadow-sm",
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow label="Snap to grid" description="Dragged nodes land on the grid.">
          <Toggle
            label="Snap to grid"
            checked={snap}
            onChange={(v) => update({ canvasSnapToGrid: v })}
          />
        </SettingRow>
        <SettingRow label="Minimap" description="Overview in the bottom-right corner.">
          <Toggle
            label="Canvas minimap"
            checked={minimap}
            onChange={(v) => update({ canvasMinimap: v })}
          />
        </SettingRow>
      </div>
    </div>
  )
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
    </div>
  )
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {children}
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "bg-primary" : "bg-input",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-card shadow-sm transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  )
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  )
}
