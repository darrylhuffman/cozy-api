import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function InspectorPanel() {
  return (
    <Tabs defaultValue="inspect" className="flex h-full flex-col">
      <TabsList className="m-2 grid w-[calc(100%-1rem)] grid-cols-3">
        <TabsTrigger value="inspect">Inspect</TabsTrigger>
        <TabsTrigger value="tests">Tests</TabsTrigger>
        <TabsTrigger value="run">Run</TabsTrigger>
      </TabsList>
      <TabsContent value="inspect" className="flex-1 overflow-auto p-3">
        <PlaceholderCard
          title="Inspect"
          body="Node config and advanced settings for the selected node."
        />
      </TabsContent>
      <TabsContent value="tests" className="flex-1 overflow-auto p-3">
        <PlaceholderCard
          title="Tests"
          body="Workflow + node test list, pass/fail status, run controls."
        />
      </TabsContent>
      <TabsContent value="run" className="flex-1 overflow-auto p-3">
        <PlaceholderCard title="Run" body="Request input, timeline, step controls during runs." />
      </TabsContent>
    </Tabs>
  )
}

function PlaceholderCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-sm">
      <div className="mb-1 font-medium">{title}</div>
      <p className="text-xs text-muted-foreground">{body}</p>
    </div>
  )
}
