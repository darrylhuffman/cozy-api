import {
  ENVIRONMENTS_FILE,
  type EnvironmentsFile,
  LOCAL_ENVIRONMENTS_FILE,
  mergeEnvironments,
  parseEnvironments,
} from "@darrylondil/lorien-runtime/requests"
import { create } from "zustand"
import { ApiError, fetchFile } from "@/lib/api"

const SELECTED_KEY = "lorien-ide-environment"

interface State {
  envs: EnvironmentsFile
  loaded: boolean
  error: string | null
  /** User's pick; persisted per browser. null = the file's default. */
  selected: string | null
  load(): Promise<void>
  select(name: string | null): void
}

function readSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY)
  } catch {
    return null
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return (await fetchFile(path)).content
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

export const useEnvironments = create<State>((set) => ({
  envs: { lorien: 1, environments: {} },
  loaded: false,
  error: null,
  selected: readSelected(),

  async load() {
    try {
      const [shared, local] = await Promise.all([
        readOptional(ENVIRONMENTS_FILE),
        readOptional(LOCAL_ENVIRONMENTS_FILE),
      ])
      const envs = mergeEnvironments(
        shared === null ? null : parseEnvironments(shared, ENVIRONMENTS_FILE),
        local === null ? null : parseEnvironments(local, LOCAL_ENVIRONMENTS_FILE),
      )
      set({ envs, loaded: true, error: null })
    } catch (e) {
      set({ loaded: true, error: (e as Error).message })
    }
  },

  select(name) {
    try {
      if (name === null) localStorage.removeItem(SELECTED_KEY)
      else localStorage.setItem(SELECTED_KEY, name)
    } catch {
      // Private mode — the pick just won't persist.
    }
    set({ selected: name })
  },
}))

/** The active environment's name and variables. */
export function activeEnvironment(s: Pick<State, "envs" | "selected">): {
  name: string | null
  vars: Record<string, string>
} {
  const names = Object.keys(s.envs.environments)
  const name =
    s.selected && names.includes(s.selected)
      ? s.selected
      : s.envs.default && names.includes(s.envs.default)
        ? s.envs.default
        : (names[0] ?? null)
  return { name, vars: name ? (s.envs.environments[name] ?? {}) : {} }
}

export const ENVIRONMENTS_TEMPLATE = `${JSON.stringify(
  {
    lorien: 1,
    default: "local",
    environments: {
      local: { token: "dev-token" },
      staging: { baseUrl: "https://staging.example.com", token: "" },
    },
  },
  null,
  2,
)}\n`
