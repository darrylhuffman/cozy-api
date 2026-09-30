import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { configureMonacoLoader } from "@/lib/monaco-loader"
import { applyStoredTheme } from "@/store/theme"
import { App } from "./app.js"
import "@fontsource/ibm-plex-sans/400.css"
import "@fontsource/ibm-plex-sans/500.css"
import "@fontsource/ibm-plex-sans/600.css"
import "@fontsource/ibm-plex-sans/700.css"
import "@fontsource/jetbrains-mono/400.css"
import "@fontsource/jetbrains-mono/500.css"
import "./globals.css"

// Apply the persisted theme before first paint to avoid a flash.
applyStoredTheme()

configureMonacoLoader()

const root = document.getElementById("root")
if (!root) throw new Error("missing #root element")
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
