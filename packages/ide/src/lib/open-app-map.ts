import { useDockviewApi } from "@/store/dockview-api"
import { useTabsStore } from "@/store/tabs"

export const APP_MAP_TAB_ID = "app-map"

/** Opens the read-only Application map in the editor (or switches to it). */
export function openAppMap(): void {
  useTabsStore.getState().openTab({ id: APP_MAP_TAB_ID, title: "Application map", kind: "map" })
  useDockviewApi.getState().api?.getPanel("editor")?.api.setActive()
}
