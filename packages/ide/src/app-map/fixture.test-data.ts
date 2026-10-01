import type { NodeSchemas, ProviderInfo, WorkflowFile } from "@/lib/api"
import type { AppMapInput } from "./model"

const schema = (name: string): NodeSchemas => ({ name, inputs: {}, outputs: {} })
const provider = (name: string, usedBy: string[]): ProviderInfo => ({
  name,
  path: `providers/${name}.ts`,
  lifetime: "singleton",
  uses: [],
  env: [],
  hasDispose: false,
  packages: [],
  usedBy,
})
const wf = (method: string, nodes: Record<string, string>): WorkflowFile => ({
  lorien: 1,
  nodes: {
    trigger: { uses: "@core/http-request", values: { method } },
    ...Object.fromEntries(Object.entries(nodes).map(([id, uses]) => [id, { uses }])),
    respond: { uses: "@core/http-response" },
  },
})

/** A small pet shop: two pet routes behind admin middleware, and a hello route. */
export const petShop: AppMapInput = {
  workflows: [
    { path: "workflows/hello.workflow", file: wf("GET", { greet: "./nodes/say-hello" }) },
    {
      path: "workflows/admin/pets/create.workflow",
      file: wf("POST", { add: "./nodes/pets/add-pet", log: "./nodes/audit/log" }),
    },
    {
      path: "workflows/admin/pets/list.workflow",
      file: wf("GET", { list: "./nodes/pets/list-pets" }),
    },
  ],
  schemas: {
    "./nodes/say-hello": schema("Say Hello"),
    "./nodes/pets/add-pet": schema("Add Pet"),
    "./nodes/pets/list-pets": schema("List Pets"),
    "./nodes/audit/log": schema("Audit Log"),
    "./nodes/unused": schema(""),
  },
  providers: [provider("db", ["nodes/pets/add-pet.ts"]), provider("logger", [])],
  middleware: [
    {
      dir: "workflows/admin",
      path: "workflows/admin/_middleware.ts",
      names: ["requireAdmin"],
      reads: ["db"],
    },
  ],
  nodeProviders: {
    "./nodes/pets/add-pet": ["db"],
    "./nodes/pets/list-pets": ["db"],
    "./nodes/audit/log": ["logger"],
  },
}
