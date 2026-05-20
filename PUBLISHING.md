# Publishing cozy-api packages to npm

## One-time setup

```bash
# Authenticate. Creates an npm account if you don't have one.
npm login

# Verify your identity
npm whoami
```

If you want to publish under `@cozy/*`, create the npm organization at:
**https://www.npmjs.com/org/create** (name: `cozy`).

This costs nothing for a public-only org and reserves the scope so no one else can grab it.

## Publishing v0.1.0

All four packages publish together as a coherent release. From the repo root:

```bash
# Verify everything builds and tests pass
pnpm install
pnpm -r build
pnpm -r test
pnpm -r typecheck

# Dry run — see exactly what would be uploaded WITHOUT actually publishing
pnpm -r publish --access public --dry-run --no-git-checks

# Real publish
pnpm -r publish --access public --no-git-checks
```

`pnpm publish` automatically:
- Replaces `workspace:*` deps with the actual versions of the packages being published
- Runs the package's `prepublishOnly` script (if any)
- Validates the package shape against npm registry requirements
- Uploads the tarball

`--access public` is required because `@cozy/*` is a scoped name; npm defaults scoped packages to "restricted" (private, paid plan only).

`--no-git-checks` lets you publish without requiring a git tag — useful for first-time setup. Once you have a release process, you can drop this.

## What's in the tarball

Per each package's `files` field, the tarballs contain only:

- `dist/` (compiled JS + `.d.ts`)
- `README.md`

Source files, tests, and configs are NOT shipped — keeps the install size small.

## After publishing

```bash
# Verify all four packages are live
npm view @cozy/runtime version
npm view @cozy/build version
npm view @cozy/openapi version
npm view create-cozy-api version

# Test the install end-to-end (use a fresh directory!)
cd /tmp && mkdir cozy-test && cd cozy-test
npm install @cozy/runtime
ls node_modules/@cozy/runtime/dist/
```

You can also test the scaffolder right away:

```bash
cd /tmp && npx create-cozy-api@latest test-app
cd test-app && npm install && npm run dev
```

## Versioning subsequent releases

For now, bump versions manually in each `package.json`. When the project gets busier, consider [Changesets](https://github.com/changesets/changesets) for automated cross-package version management.

Recommended bump patterns:
- **Patch (0.1.X)** — bug fixes, internal refactors
- **Minor (0.X.0)** — new features, no breaking changes
- **Major (X.0.0)** — breaking API changes (peers, exports, generated-code shape)

Until the IDE work lands, every release is likely a 0.X.0 minor bump.

## Troubleshooting

**"You do not have permission to publish"** — check `npm whoami`; ensure your account is owner of the `@cozy` org (or you've created it).

**"Package name too similar"** — npm sometimes rejects names that look like existing packages. The `@cozy/*` scope avoids this.

**`workspace:*` not replaced** — make sure you're running `pnpm publish` (not `npm publish`). pnpm handles workspace protocol substitution; npm does not.

**Pre-1.0 considerations** — at `0.X.X`, semver allows breaking changes in minor bumps. Communicate clearly in CHANGELOG entries.
