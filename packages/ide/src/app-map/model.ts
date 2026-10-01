import type { MiddlewareInfo, NodeSchemas, ProviderInfo, WorkflowFile } from "@/lib/api"
import { deriveWorkflowPath, expandTemplate } from "@/workflow/template"

/**
 * The Application map's model: every route (workflow), node, middleware and
 * provider in the workspace, and how they connect. Built from data the IDE
 * already loads (the file tree, workflow files, node schemas, providers).
 */

export type MapKind = "workflow" | "node" | "middleware" | "provider"

interface BaseItem {
  /** Unique across the map, e.g. "node:nodes/pets/add-pet.ts". */
  key: string
  kind: MapKind
  label: string
  /** The file that defines it. */
  path: string
  /** Folder it lives in, e.g. "nodes/pets". Middleware: the folder it guards. */
  folder: string
}

export interface WorkflowItem extends BaseItem {
  kind: "workflow"
  /** HTTP method, or null for a workflow without an HTTP trigger. */
  method: string | null
  route: string
  /** Node steps in file order: the step's id in the workflow and the node it runs. */
  steps: { id: string; node: string }[]
  /** Distinct node keys this workflow runs. */
  nodes: string[]
  /** Middleware keys that run before it, outermost first. */
  middleware: string[]
  responses: number
}

export interface NodeItem extends BaseItem {
  kind: "node"
  color: string | null
  description: string | null
  providers: string[]
  usedBy: { workflow: string; step: string }[]
}

export interface MiddlewareItem extends BaseItem {
  kind: "middleware"
  /** Position in its `_middleware.ts` (0 runs first). */
  order: number
  providers: string[]
  /** Workflow keys it runs in front of. */
  covers: string[]
}

export interface ProviderItem extends BaseItem {
  kind: "provider"
  info: ProviderInfo
  color: string | null
  nodes: string[]
  middleware: string[]
}

export type MapItem = WorkflowItem | NodeItem | MiddlewareItem | ProviderItem

export interface MapEdge {
  source: string
  target: string
  /** "uses": workflow runs node. "inject": node or middleware reads provider. */
  type: "uses" | "inject"
}

export interface MapFolder {
  key: string
  path: string
  name: string
  depth: number
  parent: string | null
  children: string[]
  /** Every item in this folder or below. */
  members: string[]
}

export interface AppMap {
  items: MapItem[]
  byKey: Map<string, MapItem>
  edges: MapEdge[]
  folders: Map<string, MapFolder>
}

export interface AppMapInput {
  /** Every `.workflow` file with its parsed content (null when it failed to load). */
  workflows: { path: string; file: WorkflowFile | null }[]
  /** Node schemas keyed by `uses`, e.g. "./nodes/pets/add-pet". */
  schemas: Record<string, NodeSchemas>
  providers: ProviderInfo[]
  middleware: MiddlewareInfo[]
  /** Node `uses` key → providers its `run` reads. */
  nodeProviders: Record<string, string[]>
}

const HTTP_TRIGGER = "@core/http-request"
const RESPONSE = "@core/response"

export const dirname = (path: string) => path.split("/").slice(0, -1).join("/")
const usesToPath = (uses: string) => `${uses.replace(/^\.\//, "")}.ts`
const stem = (path: string) => (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "")

/** "add-pet" → "Add Pet", for nodes whose schema has no name. */
function titleCase(s: string): string {
  return s
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

export function buildAppMap(input: AppMapInput): AppMap {
  const items: MapItem[] = []
  const byKey = new Map<string, MapItem>()
  const edges: MapEdge[] = []
  const add = <T extends MapItem>(it: T): T => {
    items.push(it)
    byKey.set(it.key, it)
    return it
  }

  for (const info of input.providers) {
    add<ProviderItem>({
      kind: "provider",
      key: `provider:${info.name}`,
      label: info.name,
      path: info.path,
      folder: dirname(info.path),
      info,
      color: info.color ?? null,
      nodes: [],
      middleware: [],
    })
  }
  const providerKey = (name: string) => (byKey.has(`provider:${name}`) ? `provider:${name}` : null)

  for (const m of input.middleware) {
    m.names.forEach((name, order) => {
      const mw = add<MiddlewareItem>({
        kind: "middleware",
        key: `middleware:${m.path}#${order}`,
        label: name ?? (m.names.length > 1 ? `Middleware ${order + 1}` : "Middleware"),
        path: m.path,
        folder: m.dir,
        order,
        providers: [],
        covers: [],
      })
      for (const name of m.reads) {
        const p = providerKey(name)
        if (!p) continue
        mw.providers.push(p)
        ;(byKey.get(p) as ProviderItem).middleware.push(mw.key)
        edges.push({ source: mw.key, target: p, type: "inject" })
      }
    })
  }

  const ensureNode = (uses: string): NodeItem => {
    const path = usesToPath(uses)
    const existing = byKey.get(`node:${path}`)
    if (existing) return existing as NodeItem
    const schema = input.schemas[uses]
    const node = add<NodeItem>({
      kind: "node",
      key: `node:${path}`,
      label: schema?.name || titleCase(stem(path)),
      path,
      folder: dirname(path),
      color: schema?.color ?? null,
      description: schema?.description ?? null,
      providers: [],
      usedBy: [],
    })
    for (const name of input.nodeProviders[uses] ?? []) {
      const p = providerKey(name)
      if (!p) continue
      node.providers.push(p)
      ;(byKey.get(p) as ProviderItem).nodes.push(node.key)
      edges.push({ source: node.key, target: p, type: "inject" })
    }
    return node
  }
  for (const uses of Object.keys(input.schemas).sort()) {
    if (uses.startsWith("./nodes/")) ensureNode(uses)
  }

  const middleware = items.filter((i): i is MiddlewareItem => i.kind === "middleware")
  for (const { path, file } of [...input.workflows].sort((a, b) => a.path.localeCompare(b.path))) {
    const entries = Object.entries(file?.nodes ?? {})
    const trigger = entries.find(([, n]) => n.uses === HTTP_TRIGGER)?.[1]
    const method = trigger ? String(trigger.values?.method ?? "GET").toUpperCase() : null
    const rawRoute = trigger?.values?.path
    const route = trigger
      ? String(
          typeof rawRoute === "string"
            ? expandTemplate(rawRoute, { workflowPath: path })
            : deriveWorkflowPath(path),
        )
      : stem(path)
    const folder = dirname(path)
    const wf = add<WorkflowItem>({
      kind: "workflow",
      key: `workflow:${path}`,
      label: method ? `${method} ${route}` : route,
      path,
      folder,
      method,
      route,
      steps: [],
      nodes: [],
      middleware: [],
      responses: entries.filter(([, n]) => n.uses === RESPONSE).length,
    })
    for (const [id, n] of entries) {
      if (!n.uses.startsWith("./nodes/")) continue
      const node = ensureNode(n.uses)
      wf.steps.push({ id, node: node.key })
      node.usedBy.push({ workflow: wf.key, step: id })
      if (!wf.nodes.includes(node.key)) {
        wf.nodes.push(node.key)
        edges.push({ source: wf.key, target: node.key, type: "uses" })
      }
    }
    // Outermost folder first, then file order (the server already sends them so).
    for (const m of middleware) {
      if (folder === m.folder || folder.startsWith(`${m.folder}/`)) {
        wf.middleware.push(m.key)
        m.covers.push(wf.key)
      }
    }
  }

  const folders = new Map<string, MapFolder>()
  const ensureFolder = (path: string): MapFolder => {
    const found = folders.get(path)
    if (found) return found
    const parts = path.split("/")
    const folder: MapFolder = {
      key: `folder:${path}`,
      path,
      name: parts[parts.length - 1] ?? path,
      depth: parts.length,
      parent: parts.length > 1 ? parts.slice(0, -1).join("/") : null,
      children: [],
      members: [],
    }
    folders.set(path, folder)
    if (folder.parent) ensureFolder(folder.parent).children.push(path)
    return folder
  }
  for (const it of items) if (it.folder) ensureFolder(it.folder)
  for (const f of folders.values()) {
    f.members = items
      .filter((i) => i.folder === f.path || i.folder.startsWith(`${f.path}/`))
      .map((i) => i.key)
    f.children.sort()
  }

  return { items, byKey, edges, folders }
}

/**
 * Everything connected to `key` along the request's path, used for Focus and
 * for hover highlighting:
 * - a workflow: its middleware, its nodes, and the providers they read
 * - a node: the workflows that run it (and their middleware), its providers
 * - a provider: the nodes and middleware that read it, and those nodes' workflows
 * - a middleware: the workflows it runs in front of, and its providers
 * - a folder ("folder:nodes/pets"): the union for everything in it
 */
export function connectedTo(map: AppMap, key: string, out = new Set<string>()): Set<string> {
  if (key.startsWith("folder:")) {
    for (const m of map.folders.get(key.slice(7))?.members ?? []) connectedTo(map, m, out)
    return out
  }
  const it = map.byKey.get(key)
  if (!it) return out
  out.add(key)
  const get = <T extends MapItem>(k: string) => map.byKey.get(k) as T
  if (it.kind === "workflow") {
    for (const n of it.nodes) {
      out.add(n)
      for (const p of get<NodeItem>(n).providers) out.add(p)
    }
    for (const m of it.middleware) {
      out.add(m)
      for (const p of get<MiddlewareItem>(m).providers) out.add(p)
    }
  } else if (it.kind === "node") {
    for (const p of it.providers) out.add(p)
    for (const u of it.usedBy) {
      out.add(u.workflow)
      for (const m of get<WorkflowItem>(u.workflow).middleware) out.add(m)
    }
  } else if (it.kind === "provider") {
    for (const n of it.nodes) {
      out.add(n)
      for (const u of get<NodeItem>(n).usedBy) out.add(u.workflow)
    }
    for (const m of it.middleware) out.add(m)
  } else {
    for (const p of it.providers) out.add(p)
    for (const w of it.covers) out.add(w)
  }
  return out
}

/** Which items are shown for the given kind switches and focus. */
export function visibleKeys(
  map: AppMap,
  kinds: ReadonlySet<MapKind>,
  focus: ReadonlySet<string>,
): Set<string> {
  let focused: Set<string> | null = null
  if (focus.size) {
    focused = new Set()
    for (const k of focus) connectedTo(map, k, focused)
  }
  return new Set(
    map.items
      .filter((i) => kinds.has(i.kind) && (!focused || focused.has(i.key)))
      .map((i) => i.key),
  )
}

/** Case-insensitive match on an item's name, route or file path. */
export function matchesQuery(it: MapItem, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return false
  return [it.label, it.path].some((s) => s.toLowerCase().includes(needle))
}
