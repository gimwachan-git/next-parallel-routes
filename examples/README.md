# Examples

| Example | What it shows |
|---|---|
| [`basic/`](./basic) | A minimal Next.js 16 `output: 'export'` app wiring all three parallel-slot groups through `withParallelRoutes` + `staticParamsFromConfig`. |
| [`auto-shim/`](./auto-shim) | `autoShimSlots`: you write only each slot's `default.tsx` and the plugin auto-generates the `[...slug]/page.tsx` fallback shims (both template branches). |

Each example depends on `next-parallel-routes` via `workspace:*`, so the local
(unpublished) package source is used automatically — no publish step required.

```bash
# from the repo root
pnpm install

# then build any example
pnpm --filter next-parallel-routes-example-basic build
```
