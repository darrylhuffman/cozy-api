import "@testing-library/jest-dom/vitest"

// jsdom does not implement ResizeObserver — dockview-core requires it.
// Provide a no-op stub so component mounting doesn't throw.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
