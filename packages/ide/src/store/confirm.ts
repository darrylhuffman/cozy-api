import { create } from "zustand"

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Styles the confirm button as destructive (discarding work, deleting). */
  destructive?: boolean
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

interface ConfirmState {
  pending: PendingConfirm | null
  request(opts: ConfirmOptions): Promise<boolean>
  answer(ok: boolean): void
}

/**
 * In-app replacement for `window.confirm`: `await confirmAction({...})`
 * resolves true/false once the user answers the dialog rendered by
 * `<ConfirmDialogHost />`.
 */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  request(opts) {
    // A newer question supersedes an unanswered one.
    get().pending?.resolve(false)
    return new Promise<boolean>((resolve) => {
      set({ pending: { ...opts, resolve } })
    })
  },
  answer(ok) {
    const p = get().pending
    if (!p) return
    set({ pending: null })
    p.resolve(ok)
  },
}))

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().request(opts)
}
