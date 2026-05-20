import type { ResolvedServices } from "./types.js"

interface MaybeDisposable {
  dispose?: () => void | Promise<void>
}

export async function disposeServices(resolved: ResolvedServices): Promise<void> {
  const tasks: Promise<unknown>[] = []
  for (const value of Object.values(resolved)) {
    if (value && typeof value === "object" && "dispose" in value) {
      const d = (value as MaybeDisposable).dispose
      if (typeof d === "function") {
        tasks.push(
          new Promise<void>((resolve) => resolve(d.call(value) as void | Promise<void>)).catch(
            () => {},
          ),
        )
      }
    }
  }
  await Promise.all(tasks)
}
