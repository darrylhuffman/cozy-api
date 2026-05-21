import { useEffect } from "react"
import { restBase } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useAgentChats, type AgentAvailability, type AvailabilityResponse } from "@/store/agent-chats"

interface AgentPickerProps {
  pickerId: string
}

export function AgentPicker({ pickerId }: AgentPickerProps): React.ReactElement {
  const availability = useAgentChats((s) => s.availability)
  const setAvailability = useAgentChats((s) => s.setAvailability)
  const startClaudeChat = useAgentChats((s) => s.startClaudeChat)

  useEffect(() => {
    let cancelled = false
    async function probe(): Promise<void> {
      try {
        const res = await fetch(`${restBase()}/__lorien/agents/availability`)
        if (!res.ok) return
        const av = (await res.json()) as AvailabilityResponse
        if (!cancelled) setAvailability(av)
      } catch {
        /* leave availability null; cards render in error state */
      }
    }
    void probe()
    return () => {
      cancelled = true
    }
  }, [setAvailability])

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="grid w-full max-w-2xl grid-cols-2 gap-4">
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
        "flex flex-col gap-3 rounded-lg border border-border bg-background p-4",
        disabled && "opacity-60",
      )}
    >
      <div>
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-muted-foreground">{vendor}</div>
      </div>
      <hr className="border-border" />
      <div className="flex-1 text-xs text-muted-foreground">
        {comingSoon ? (
          <span>Coming soon</span>
        ) : availability === undefined ? (
          <span>Detecting…</span>
        ) : availability.installed ? (
          <span>
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
          "rounded-md border border-border bg-background px-3 py-1.5 text-sm",
          !disabled && available ? "hover:bg-accent" : "cursor-not-allowed",
        )}
      >
        Start chat
      </button>
    </div>
  )
}
