import { Button } from "@/components/ui/button"

export function App() {
  return (
    <div className="flex h-full items-center justify-center bg-background text-foreground">
      <div className="space-y-4 text-center">
        <h1 className="text-3xl font-semibold">cozy-api IDE</h1>
        <p className="text-muted-foreground">
          Shell scaffolded. Layout, panels, and routing land in subsequent tasks.
        </p>
        <Button>shadcn button installed</Button>
      </div>
    </div>
  )
}
