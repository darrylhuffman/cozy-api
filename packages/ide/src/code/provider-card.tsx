import { Plug, ShieldCheck } from "lucide-react"
import type { ProviderInfo } from "@/lib/api"
import { openCodeFile } from "@/lib/open-code-file"
import { cn } from "@/lib/utils"
import {
  LIFETIME_HELP,
  middlewareFor,
  useProvidersStore,
  useWorkspaceProviders,
} from "@/store/providers"
import { resolveAccentColor } from "@/workflow/tailwind-colors"

const PROVIDER_FILE = /^providers\/[^/]+\.[mc]?ts$/

/**
 * What the code editor shows above a provider or node file: for a provider,
 * its lifetime, what it's built from, the env vars it needs and who reads it;
 * for a node, the providers its `run` reads.
 */
export function FileContextBar({ path }: { path: string }) {
  useWorkspaceProviders()
  if (PROVIDER_FILE.test(path)) return <ProviderCard path={path} />
  if (path.startsWith("nodes/")) return <NodeProvidersBar path={path} />
  if (/^workflows\/(.+\/)?_middleware\.[mc]?[jt]s$/.test(path)) return <MiddlewareBar path={path} />
  return null
}

function MiddlewareBar({ path }: { path: string }) {
  const all = useProvidersStore((s) => s.middleware)
  const self = all.find((m) => m.path === path)
  const dir = path.split("/").slice(0, -1).join("/")
  const outer = middlewareFor(all, `${dir}/x`).filter((m) => m.path !== path)
  return (
    <div
      data-testid="middleware-bar"
      className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card px-3 py-1 text-[12px] text-muted-foreground"
    >
      <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span>
        Runs before every route in <code className="font-mono text-foreground">{dir}/</code>
        {outer.length > 0 ? `, after ${outer.map((m) => m.path).join(", ")}` : ""}
      </span>
      {self && self.reads.length > 0 && (
        <>
          <span className="ml-2">Reads</span>
          {self.reads.map((name) => (
            <ProviderChip key={name} name={name} />
          ))}
        </>
      )}
    </div>
  )
}

function ProviderCard({ path }: { path: string }) {
  const provider = useProvidersStore((s) => s.providers.find((p) => p.path === path))
  if (!provider) return null
  const tint = providerTint(provider)
  const missing = provider.env.filter((e) => e.status === "missing")
  return (
    <section
      aria-label={`Provider ${provider.name}`}
      data-testid="provider-card"
      className="flex flex-col gap-1.5 border-b border-border bg-card px-3 py-2 text-[12px]"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Plug aria-hidden className="h-3.5 w-3.5 shrink-0" style={{ color: tint }} />
        <span className="truncate font-semibold text-[13px]">
          {provider.label ?? provider.name}
        </span>
        <span className="text-muted-foreground">
          nodes read it as <code className="font-mono text-foreground">{provider.name}</code>
        </span>
        <span
          title={LIFETIME_HELP[provider.lifetime]}
          className="ml-auto shrink-0 rounded px-1.5 py-px font-mono text-[10.5px]"
          style={{ color: tint, background: `color-mix(in srgb, ${tint} 14%, transparent)` }}
        >
          {provider.lifetime}
        </span>
      </div>
      <div className="text-muted-foreground">
        {LIFETIME_HELP[provider.lifetime]}
        {provider.hasDispose && " Cleaned up by its dispose."}
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
        {provider.uses.length > 0 && (
          <Row label="Uses">
            {provider.uses.map((name) => (
              <ProviderChip key={name} name={name} />
            ))}
          </Row>
        )}
        {provider.env.length > 0 && (
          <Row label="Env">
            {provider.env.map((e) => (
              <span
                key={e.key}
                title={ENV_HELP[e.status]}
                className={cn(
                  "rounded bg-accent px-1.5 py-px font-mono text-[10.5px]",
                  e.status === "missing" ? "text-destructive" : "text-foreground/85",
                )}
              >
                {e.key}
                {e.status === "missing" && " missing"}
              </span>
            ))}
          </Row>
        )}
        {provider.packages.length > 0 && (
          <Row label="Packages">
            {provider.packages.map((p) => (
              <span key={p} className="font-mono text-[11px] text-foreground/85">
                {p}
              </span>
            ))}
          </Row>
        )}
        <Row label="Read by">
          {provider.usedBy.length === 0 ? (
            <span className="text-muted-foreground">No nodes yet</span>
          ) : (
            provider.usedBy.map((file) => (
              <button
                key={file}
                type="button"
                onClick={() => openCodeFile(file)}
                className="font-mono text-[11px] text-foreground/85 underline-offset-2 hover:text-foreground hover:underline"
              >
                {file.replace(/^nodes\//, "").replace(/\.ts$/, "")}
              </button>
            ))
          )}
        </Row>
      </dl>
      {missing.length > 0 && (
        <div className="text-destructive">
          Set {missing.map((e) => e.key).join(", ")} before starting the app, or it will refuse to
          boot.
        </div>
      )}
    </section>
  )
}

function NodeProvidersBar({ path }: { path: string }) {
  const uses = `./${path.replace(/\.[mc]?ts$/, "")}`
  const names = useProvidersStore((s) => s.nodes[uses])
  if (!names || names.length === 0) return null
  return (
    <div
      data-testid="node-providers-bar"
      className="flex items-center gap-1.5 border-b border-border bg-card px-3 py-1 text-[12px]"
    >
      <span className="text-muted-foreground">Reads</span>
      {names.map((name) => (
        <ProviderChip key={name} name={name} />
      ))}
    </div>
  )
}

/** A provider by name; opens its file. */
export function ProviderChip({ name, className }: { name: string; className?: string }) {
  const provider = useProvidersStore((s) => s.providers.find((p) => p.name === name))
  const tint = provider ? providerTint(provider) : "var(--muted-foreground)"
  return (
    <button
      type="button"
      disabled={!provider}
      title={provider ? `${provider.lifetime} provider, open ${provider.path}` : undefined}
      onClick={(e) => {
        e.stopPropagation()
        if (provider) openCodeFile(provider.path)
      }}
      className={cn(
        "nodrag inline-flex items-center gap-1 rounded px-1.5 py-px font-mono text-[10.5px] hover:brightness-125",
        className,
      )}
      style={{ color: tint, background: `color-mix(in srgb, ${tint} 14%, transparent)` }}
    >
      {name}
    </button>
  )
}

export function providerTint(p: Pick<ProviderInfo, "color">): string {
  return p.color ? resolveAccentColor(p.color) : "var(--muted-foreground)"
}

const ENV_HELP: Record<ProviderInfo["env"][number]["status"], string> = {
  set: "Set in this environment",
  default: "Not set; its default is used",
  optional: "Optional and not set",
  missing: "Required and not set",
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</dd>
    </>
  )
}
