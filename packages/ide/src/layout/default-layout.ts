import type { DockviewApi } from "dockview-react";

const STORAGE_KEY = "lorien-ide-layout";

export interface SavedLayout {
  version: 1;
  state: ReturnType<DockviewApi["toJSON"]>;
}

/**
 * Loads a saved layout from localStorage if one exists.
 * Returns null if absent or malformed.
 */
export function loadSavedLayout(): SavedLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedLayout;
    if (parsed.version !== 1 || !parsed.state) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Saves the current layout to localStorage.
 */
export function saveLayout(api: DockviewApi): void {
  try {
    const payload: SavedLayout = { version: 1, state: api.toJSON() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage may be unavailable in some browsers (private mode, quota)
    // — swallow rather than crash the app
  }
}

/**
 * Builds the default Layout B arrangement.
 */
export function buildDefaultLayout(api: DockviewApi): void {
  api.addPanel({
    id: "files",
    component: "files",
    title: "Files",
  });
  api.addPanel({
    id: "editor",
    component: "editor",
    title: "Welcome",
    position: { referencePanel: "files", direction: "right" },
  });
  api.addPanel({
    id: "inspector",
    component: "inspector",
    title: "Inspector",
    position: { referencePanel: "editor", direction: "right" },
  });
}

export { STORAGE_KEY };
