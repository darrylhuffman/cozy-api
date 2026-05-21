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

// jsdom does not implement window.matchMedia — topbar.tsx (dark mode detection) needs it.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

// jsdom does not implement EventSource — used by lib/events.ts for SSE.
// Provide a minimal stub so components that call subscribeToFileEvents don't throw.
class FakeEventSource {
  url: string
  constructor(url: string) {
    this.url = url
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
if (typeof globalThis.EventSource === "undefined") {
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
}
