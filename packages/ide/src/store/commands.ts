import { create } from "zustand"

/**
 * Actions the title-bar menus (and the status bar) can trigger. Whatever
 * owns an action registers it while it is mounted: the open workflow editor
 * registers the canvas actions, the Explorer the "new file" actions.
 */
export type CommandId =
  | "file.newWorkflow"
  | "file.newNode"
  | "file.newProvider"
  | "file.newFolder"
  | "file.save"
  | "edit.undo"
  | "edit.redo"
  | "edit.duplicate"
  | "canvas.addNode"
  | "canvas.fitView"
  | "canvas.tidy"
  | "help.shortcuts"

export interface Command {
  run: () => void
  /** False greys the menu item out (e.g. nothing to undo). */
  enabled?: boolean
}

interface CommandsState {
  commands: Partial<Record<CommandId, Command>>
  register(commands: Partial<Record<CommandId, Command>>): () => void
}

export const useCommands = create<CommandsState>()((set, get) => ({
  commands: {},
  register(commands) {
    set((s) => ({ commands: { ...s.commands, ...commands } }))
    return () => {
      // Only drop entries that are still ours; a newer owner may have
      // replaced them in the meantime.
      const current = get().commands
      const next = { ...current }
      for (const [id, cmd] of Object.entries(commands) as [CommandId, Command][]) {
        if (current[id] === cmd) delete next[id]
      }
      set({ commands: next })
    }
  },
}))

/** Runs a command if something has registered it and it is enabled. */
export function runCommand(id: CommandId): void {
  const cmd = useCommands.getState().commands[id]
  if (cmd && cmd.enabled !== false) cmd.run()
}

export function useCommandEnabled(id: CommandId): boolean {
  return useCommands((s) => {
    const cmd = s.commands[id]
    return Boolean(cmd) && cmd?.enabled !== false
  })
}
