# Saved requests

Saved requests are lorien's built-in "dev Postman". They live in the repo next to the
workflow they call, so everyone on the team gets the same set, and CI runs them too.

```
workflows/users/create.workflow
workflows/users/create.requests.json   ← saved requests for that workflow
lorien.environments.json               ← shared variables per environment
lorien.environments.local.json         ← your own overrides (git-ignore this)
```

## In the IDE

Open a workflow, then the **Run** tab in the right-hand panel.

- **Saved requests** lists the workflow's requests with their last result. Click one to
  load it, ▶ to run it, **Run all** to run them in order.
- Build or edit a request below, add **checks**, and press **Save**. Saving writes the
  `.requests.json` file straight away.
- **Add checks from this response** pins the current status, content type and top-level
  fields after a Send.
- **Env** picks the environment; **Edit** opens `lorien.environments.json` (created
  from a template the first time).

## File format

```json
{
  "lorien": 1,
  "requests": [
    {
      "id": "createsAUser",
      "name": "Creates a user",
      "trigger": "Request",
      "method": "POST",
      "path": "/users",
      "headers": { "Authorization": "Bearer {{token}}" },
      "body": { "kind": "json", "json": { "email": "dev-{{$randomInt}}@example.com" } },
      "expect": [
        { "target": "status", "op": "equals", "value": 200 },
        { "target": "body", "path": "id", "op": "type", "value": "string" }
      ],
      "capture": { "userId": "body.id" }
    }
  ]
}
```

- `body.kind` is `json` (with `json`), `text` or `xml` (with `text`), or `form` (with `form`).
- `{{name}}` is replaced from the environment, or from `capture` of an earlier request in
  the same run. Built-ins: `{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`.
- Checks: `target` is `status`, `header` (with `path` = header name), `body` (with an
  optional `path` like `items[0].name`) or `duration`. `op` is `equals`, `notEquals`,
  `contains` (substring, or subset for objects and arrays), `exists`, `notExists`,
  `matches` (regex), `lessThan`, `greaterThan` or `type`.
- A request with no checks passes when its status is below 400.

## Environments

```json
{
  "lorien": 1,
  "default": "local",
  "environments": {
    "local": { "token": "dev-token" },
    "staging": { "baseUrl": "https://staging.example.com", "token": "" }
  }
}
```

A `baseUrl` variable sends the IDE's requests to that server instead of the workflows the
IDE is running. Values in `lorien.environments.local.json` win over the shared file.

## In CI

```sh
lorien test                 # runs node cases, then every collection in-process; exits 1 on failure
lorien test users --env ci  # only collections whose path contains "users"
lorien test --base-url http://localhost:3000   # against a running server
lorien test --json
```

Or from Vitest, as `examples/basic-api/src/requests.test.ts` does:

```ts
import { failureSummary, runRequestCollections } from "@darrylondil/lorien-runtime/testing"

const runs = await runRequestCollections({ root, app: await startLorienServer({ root }) })
for (const run of runs)
  for (const r of run.results)
    test(`${run.path} › ${r.name}`, () => expect(failureSummary(r)).toEqual([]))
```
