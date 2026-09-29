interface EmptyStateProps {
  onStart(): void
}

export function EmptyState({ onStart }: EmptyStateProps): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-sm text-muted-foreground">
        Chat with an AI agent to edit workflows and nodes in this project.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
      >
        Start your first chat
      </button>
    </div>
  )
}
