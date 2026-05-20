# @darrylondil/lorien-openapi

OpenAPI 3.x → lorien-api `defineNode` client generator.

```ts
import { convertOpenApiSpec, writeGeneratedFiles } from "@darrylondil/lorien-openapi"

const generated = await convertOpenApiSpec(spec, { outRoot: "./nodes/petstore" })
await writeGeneratedFiles(generated, { force: false })
```

Or via the CLI in @darrylondil/lorien-build:

```
npx lorien import-openapi petstore.json
```

See the design spec at `docs/superpowers/specs/2026-05-20-lorien-openapi-design.md`.
