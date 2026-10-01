/** Two stacked cards: a sub-workflow, several nodes in one. */
export function SubworkflowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none">
      <rect x="1.5" y="5.5" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M4.5 3.5h7a1.5 1.5 0 0 1 1.5 1.5v7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
