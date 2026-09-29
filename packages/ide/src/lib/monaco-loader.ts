import { loader } from "@monaco-editor/react"

/**
 * Points the Monaco loader at the copy bundled with the IDE (see
 * vite.config.ts) instead of its default CDN, so the code editor works
 * offline and always matches the installed monaco-editor version.
 */
export function configureMonacoLoader(base: string = document.baseURI): void {
  loader.config({ paths: { vs: new URL("monaco/vs", base).href } })
}
