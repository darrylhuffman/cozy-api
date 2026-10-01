# Sub-workflows

A sub-workflow is a `.workflow` file under `nodes/` that other workflows use like a node. Use one when several workflows repeat the same group of nodes, such as "find the event or answer 404".

```
nodes/orders/reserve-seats.workflow   →   uses: "./nodes/orders/reserve-seats"
```

Callers write `uses` without the extension, the same as for a TypeScript node. That means a sub-workflow and a `.ts` node can't share a name.

## The file

A sub-workflow begins at an `@core/input` node and ends at an `@core/output` node. It has no HTTP Request trigger.

```json
{
  "lorien": 1,
  "label": "Reserve seats",
  "nodes": {
    "Input": {
      "uses": "@core/input",
      "values": { "fields": { "eventId": "string", "quantity": "number" } }
    },
    "FindEvent": { "uses": "./nodes/events/find-event", "in": { "id": "Input.eventId" } },
    "NoEvent": {
      "uses": "@core/response",
      "when": "!FindEvent.found",
      "values": { "status": 404, "body": { "error": "event not found" } }
    },
    "Capacity": {
      "uses": "./nodes/orders/check-capacity",
      "when": "FindEvent.found",
      "in": { "event": "FindEvent.event", "quantity": "Input.quantity" }
    },
    "Output": {
      "uses": "@core/output",
      "in": { "event": "FindEvent.event", "totalCents": "Capacity.totalCents" }
    }
  }
}
```

- **Inputs:** each key under `values.fields` on the Input node is one input. Nodes inside read it as `Input.<field>`. A field's type is a type name (`"string"`, `"number"`, `"boolean"`, `"json"`) or a JSON Schema.
- **Outputs:** each key under `in` on the Output node is one output.
- **`label`:** the name shown on the node's card. Without one, the name comes from the file name.

## Using it

```json
"ReserveSeats": {
  "uses": "./nodes/orders/reserve-seats",
  "in": { "eventId": "Request.params.id", "quantity": "Request.body.quantity" }
},
"Create": {
  "uses": "./nodes/orders/create-order",
  "in": { "eventId": "ReserveSeats.event.id", "totalCents": "ReserveSeats.totalCents" }
}
```

A sub-workflow node behaves like any other node:

- Inputs are wired with `in` or set with `values`. Each input must be wired separately; a single whole-object reference isn't allowed.
- `when` and `after` apply to the sub-workflow as a whole. If its run condition is false, nothing inside it runs.
- It hands back all of its outputs or none. If the Output node is skipped, every node that reads from the sub-workflow is skipped too.
- A Response node inside a sub-workflow answers the request, just as it would in the calling workflow.
- A bad request value that reaches a node inside a sub-workflow still gets a 400 answer.
- Sub-workflows can use other sub-workflows. A sub-workflow that ends up using itself is an error.

## How it runs

Before a workflow runs, the dev server, `lorien test` and `lorien build` all **flatten** it. Each sub-workflow node is replaced by the nodes inside it, renamed `<Node>__<Inner>`, so `ReserveSeats__FindEvent`. Dev and production therefore run the same graph, and a built server pays nothing for using sub-workflows. In traces and the debugger, inner nodes appear under their flattened ids.

For workflow tests, `loadWorkflowFile(root, "orders/create")` returns a workflow that is already flattened. You can also pass `subworkflows: await loadSubworkflows(root)` to `testWorkflow` or `traceWorkflow`.

`lorien check` reports a sub-workflow node that wires an input it doesn't have, reads an output it doesn't have, or uses itself. It also reports a sub-workflow that uses a node file that doesn't exist.
