import { reopenPanel } from "@/layout/default-layout"
import { useAgentChats } from "@/store/agent-chats"
import { useDockviewApi } from "@/store/dockview-api"
import { type AiRequest, renderPrompt } from "./prompts"

/** Opens the Agents panel with a new Claude chat that starts on this request. */
export function askAi(req: AiRequest): void {
  const api = useDockviewApi.getState().api
  if (api) {
    if (api.getPanel("agents")) api.getPanel("agents")?.api.setActive()
    else reopenPanel(api, "agents")
  }
  useAgentChats.getState().startChatWith({ title: req.title, prompt: renderPrompt(req) })
}
