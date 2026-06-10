# next-parallel-routes

Monorepo for [`next-parallel-routes`](./packages/next-parallel-routes) — a drop-in
`next.config` plugin that dedupes `generateStaticParams` across parallel-route
`page.tsx` siblings under `output: 'export'`.
**Docs live in the [package README](./packages/next-parallel-routes/README.md).**

pnpm workspace:

- `packages/next-parallel-routes` — the published package
- `examples/basic` — Next.js 16 app consuming it via `workspace:*`
  (try unreleased changes without publishing)

```bash
pnpm install
pnpm test            # package unit tests
pnpm build:examples  # static-export build of the example apps
```
