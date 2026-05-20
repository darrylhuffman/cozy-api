# @cozy/openapi

OpenAPI 3.x → cozy-api `defineNode` client generator.

```ts
import { convertOpenApiSpec, writeGeneratedFiles } from "@cozy/openapi"

const generated = await convertOpenApiSpec(spec, { outRoot: "./nodes/petstore" })
await writeGeneratedFiles(generated, { force: false })
```

Or via the CLI in @cozy/build:

```
npx cozy import-openapi petstore.json
```

See the design spec at `docs/superpowers/specs/2026-05-20-cozy-openapi-design.md`.
