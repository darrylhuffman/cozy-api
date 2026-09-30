#!/usr/bin/env node
// Committed launcher so package managers can link the `lorien` bin on a fresh
// install, before dist/ has been built.
import { main } from "../dist/cli.js"

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
