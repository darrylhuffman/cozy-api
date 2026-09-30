import { showPanel } from "@/layout/default-layout"
import { useAgentChats } from "@/store/agent-chats"
import { useDockviewApi } from "@/store/dockview-api"
import { type AiRequest, renderPrompt } from "./prompts"

/** Opens (or focuses) the Agents pane. */
export function showAgents(): void {
  const api = useDockviewApi.getState().api
  if (api) showPanel(api, "agents")
}

/** The top-bar button: opens the Agents pane, or closes it when it is open. */
export function toggleAgents(): void {
  const api = useDockviewApi.getState().api
  if (!api) return
  const panel = api.getPanel("agents")
  if (panel) api.removePanel(panel)
  else showPanel(api, "agents")
}

/** Opens the Agents pane with a new Claude chat that starts on this request. */
export function askAi(req: AiRequest): void {
  showAgents()
  useAgentChats.getState().startChatWith({ title: req.title, prompt: renderPrompt(req) })
}
