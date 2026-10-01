import { create } from "zustand"

/** Whether the Application map popup is showing. */
export const useAppMapDialog = create<{ open: boolean; setOpen(open: boolean): void }>()((set) => ({
  open: false,
  setOpen(open) {
    set({ open })
  },
}))

/** Opens the read-only Application map. */
export function openAppMap(): void {
  useAppMapDialog.getState().setOpen(true)
}
