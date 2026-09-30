import { showPanel } from "@/layout/default-layout"
import { useAgentChats } from "@/store/agent-chats"
import { useDockviewApi } from "@/store/dockview-api"
import { useInspectorTab } from "@/store/inspector-tab"
import { type AiRequest, renderPrompt } from "./prompts"

/** Brings the sidebar's Agents tab into view. */
export function showAgents(): void {
  const api = useDockviewApi.getState().api
  if (api) showPanel(api, "inspector")
  useInspectorTab.getState().setTab("agents")
}

/** Opens the Agents tab with a new Claude chat that starts on this request. */
export function askAi(req: AiRequest): void {
  showAgents()
  useAgentChats.getState().startChatWith({ title: req.title, prompt: renderPrompt(req) })
}
