# Node test cases

Each of your nodes can carry test cases in a file next to it:

```
nodes/user/save-user.ts
nodes/user/save-user.cases.json
```

## In the IDE

Open a workflow and the **Tests** tab in the right-hand panel. Every node from `nodes/`
that the workflow uses gets a group; the selected node's group opens first.

- ▶ runs one case, a node's cases, or **Run all**. Runs happen in a fresh process on the
  IDE server, so edits to node code apply without a restart. What the node logs appears
  under "Output from the last run".
- **New case** starts from a sample built from the node's input schema.
- **From last run** turns the node's input and output (or error) from the most recent
  debug run of this workflow into a case. Send a request from the Run tab first.
- Nodes show a pass/fail badge on the canvas once their cases have run.

## File format

```json
{
  "lorien": 1,
  "cases": [
    {
      "id": "returnsTheStoredRecord",
      "name": "Returns what the database stored",
      "input": { "email": "ada@example.com", "password": "correct-horse" },
      "mocks": { "db": { "createUser": { "returns": { "id": "u_1", "email": "ada@example.com" } } } },
      "expect": { "output": { "user": { "id": "u_1" } } }
    },
    {
      "id": "rejectsAShortPassword",
      "name": "Rejects a password under 6 characters",
      "input": { "email": "ada@example.com", "password": "123" },
      "expect": { "error": "password" }
    }
  ]
}
```

- The input is validated against the node's `inputs` schema first, exactly as the
  interpreter does, so a bad input fails with the same message you'd see in a run.
- `expect.output` passes when the output contains those fields (`"match": "equals"` for an
  exact match). The output must also fit the node's `outputs` schema.
- `expect.error` passes when the node throws and the message contains the text (`""`
  accepts any error).
- Providers come from `providers/`. `mocks` replaces a whole provider for that case with
  just the listed methods; each is `{ "returns": value }` or `{ "throws": "message" }`,
  returned (or thrown) synchronously, so it stands in for sync and async clients alike.

## In CI

`lorien test` runs node cases and then [saved requests](./saved-requests.md). Use
`--no-requests` or `--no-nodes` to run one kind. From Vitest:

```ts
import { runNodeCases } from "@darrylondil/lorien-runtime/testing"

for (const file of await runNodeCases({ root }))
  for (const r of file.results) test(`${file.path} › ${r.name}`, () => expect(r.failures).toEqual([]))
```
