import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { configureMonacoLoader } from "@/lib/monaco-loader"
import { applyTheme } from "@/store/theme"
import { App } from "./app.js"
import "@fontsource/ibm-plex-sans/400.css"
import "@fontsource/ibm-plex-sans/500.css"
import "@fontsource/ibm-plex-sans/600.css"
import "@fontsource/ibm-plex-sans/700.css"
import "@fontsource/jetbrains-mono/400.css"
import "@fontsource/jetbrains-mono/500.css"
import "./globals.css"

// Apply persisted / system theme before first paint to avoid flash.
// The store's onRehydrateStorage handles it on subsequent renders; this
// call ensures no FOUC on the very first paint before React mounts.
;(() => {
  try {
    const stored = JSON.parse(localStorage.getItem("lorien-ide-theme") ?? "{}")
    const t = stored?.state?.theme
    if (t === "light" || t === "dark") {
      applyTheme(t)
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      applyTheme("dark")
    }
  } catch {
    // ignore — store will handle it
  }
})()

configureMonacoLoader()

const root = document.getElementById("root")
if (!root) throw new Error("missing #root element")
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
