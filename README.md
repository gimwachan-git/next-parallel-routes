# next-parallel-routes (monorepo)

This repository is an npm-workspaces monorepo:

| Path | Description |
|---|---|
| [`packages/next-parallel-routes`](./packages/next-parallel-routes) | The publishable package. A drop-in `next.config` plugin that dedupes `generateStaticParams` across parallel-route `page.tsx` siblings under `output: 'export'`. See its [README](./packages/next-parallel-routes/README.md). |
| [`examples/basic`](./examples/basic) | A minimal Next.js 16 app wiring up all three parallel-slot groups. It depends on the package via the workspace, so no publish step is needed to try it. |

This is a **pnpm** workspace (see `pnpm-workspace.yaml`).

## Setup

```bash
pnpm install   # at the repo root — links the workspace package into examples/
```

`examples/basic` depends on `next-parallel-routes` via `workspace:*`, so it
resolves to the local `packages/next-parallel-routes` source — you can run the
example against unreleased changes without publishing.

## Common tasks

```bash
pnpm test                 # unit tests for the package
pnpm check-type           # type-check the package
pnpm build:example        # static-export build of examples/basic
```

## Publishing the package

The package is published from its own directory; the root is private and never
published.

```bash
cd packages/next-parallel-routes
npm publish               # unscoped public package; run `npm login` first
```
