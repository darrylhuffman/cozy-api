import { Bot } from "lucide-react"
import { useEffect, useState } from "react"
import { restBase } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  type AgentAvailability,
  type AvailabilityResponse,
  useAgentChats,
} from "@/store/agent-chats"

interface AgentPickerProps {
  pickerId: string
}

type ProbeState = { kind: "loading" } | { kind: "ok" } | { kind: "error"; message: string }

export function AgentPicker({ pickerId }: AgentPickerProps): React.ReactElement {
  const availability = useAgentChats((s) => s.availability)
  const setAvailability = useAgentChats((s) => s.setAvailability)
  const startClaudeChat = useAgentChats((s) => s.startClaudeChat)
  const [probeState, setProbeState] = useState<ProbeState>({ kind: "loading" })

  useEffect(() => {
    let cancelled = false
    async function probe(): Promise<void> {
      try {
        const res = await fetch(`${restBase()}/__lorien/agents/availability`)
        if (!res.ok) {
          if (!cancelled) {
            setProbeState({
              kind: "error",
              message: `Broker responded ${res.status}. Is \`lorien dev\` running?`,
            })
          }
          return
        }
        const av = (await res.json()) as AvailabilityResponse
        if (!cancelled) {
          setAvailability(av)
          setProbeState({ kind: "ok" })
        }
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof TypeError
            ? `Couldn't reach the agent broker at ${restBase()}. Is \`lorien dev\` running?`
            : `Unexpected error: ${(err as Error).message}`
        setProbeState({ kind: "error", message })
      }
    }
    void probe()
    return () => {
      cancelled = true
    }
  }, [setAvailability])

  if (probeState.kind === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-destructive">{probeState.message}</p>
        <p className="text-xs text-muted-foreground">
          Run <code className="rounded bg-muted/40 px-1 font-mono">{`npm run dev:server`}</code> (or{" "}
          <code className="rounded bg-muted/40 px-1 font-mono">{`pnpm dev:server`}</code>) in your
          project, then close this tab and start a new chat.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="grid w-full max-w-md grid-cols-1 gap-3">
        <AgentCard
          name="Claude Code"
          vendor="Anthropic"
          availability={availability?.claude}
          available={availability?.claude.installed === true}
          actionLabel="Start chat with Claude"
          onStart={() => startClaudeChat(pickerId)}
          disabled={availability?.claude.installed !== true}
          comingSoon={false}
        />
        <AgentCard
          name="Codex"
          vendor="OpenAI"
          availability={availability?.codex}
          available={false}
          actionLabel="Start chat with Codex"
          onStart={() => {
            /* never called — Codex is disabled */
          }}
          disabled
          comingSoon
        />
      </div>
    </div>
  )
}

interface AgentCardProps {
  name: string
  vendor: string
  availability: AgentAvailability | undefined
  available: boolean
  actionLabel: string
  onStart(): void
  disabled: boolean
  comingSoon: boolean
}

function AgentCard({
  name,
  vendor,
  availability,
  available,
  actionLabel,
  onStart,
  disabled,
  comingSoon,
}: AgentCardProps): React.ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4",
        disabled && "opacity-60",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ai/15 text-ai"
        >
          <Bot className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{name}</div>
          <div className="text-xs text-muted-foreground">{vendor}</div>
        </div>
      </div>
      <div className="flex-1 text-xs text-muted-foreground">
        {comingSoon ? (
          <span>Coming soon</span>
        ) : availability === undefined ? (
          <span>Detecting…</span>
        ) : availability.installed ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
            Installed{availability.version ? ` (v${availability.version})` : ""}
          </span>
        ) : (
          <span>
            Not installed — see{" "}
            <a
              href="https://docs.anthropic.com/claude-code"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              install instructions
            </a>
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label={actionLabel}
        onClick={onStart}
        disabled={disabled || !available}
        className={cn(
          "h-8 rounded-md px-3 text-[13px] font-medium",
          !disabled && available
            ? "bg-ai text-white hover:bg-ai/90"
            : "cursor-not-allowed border border-border bg-background text-muted-foreground",
        )}
      >
        Start chat
      </button>
    </div>
  )
}
