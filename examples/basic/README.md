# Basic example

A minimal Next.js 16 app under `output: 'export'` that wires up all three
parallel-slot groups through `next-parallel-routes`.

## Route registry (single source of truth)

`next.config.ts` declares every statically-exported route in `paths`:

```
/account/
/account/info/
/docs/getting-started/
/docs/api/
```

These must match the real `page.tsx` files exactly — the plugin hard-errors
on drift (extra page, or `paths` entry with no page).

## File tree

```
app/
├─ layout.tsx                      root layout — receives @breadcrumbs + @sidebar slots
├─ page.tsx                        /  (root, not part of the registry)
├─ default.tsx                     children-slot fallback
│
├─ account/page.tsx               → /account/
├─ account/info/page.tsx          → /account/info/
├─ docs/getting-started/page.tsx  → /docs/getting-started/
├─ docs/api/page.tsx              → /docs/api/
│
├─ @breadcrumbs/                   ── Group 1: dictionary-driven mirror ──
│  ├─ default.tsx
│  └─ [...slug]/page.tsx           returns ALL paths; reads params → PATH_LABELS
│
└─ @sidebar/                       ── Group 2 + Group 3 ──
   ├─ default.tsx
   ├─ [...slug]/page.tsx           Group 2: fallback shim (re-exports default)
   └─ docs/[...slug]/page.tsx      Group 3: nested catch-all, filtered to /docs/*
lib/
└─ path-labels.ts                  dictionary used by the Group 1 slot
```

## The 3 groups

| Group | Marker file | Plugin behaviour |
|---|---|---|
| 1. Dictionary-driven mirror | `@breadcrumbs/[...slug]/page.tsx` | GSP returns the full `paths` set; component reads `params` and renders per-route content. |
| 2. Fallback shim | `@sidebar/[...slug]/page.tsx` | GSP returns the full `paths` set; content re-exports `default.tsx`. Exists only so the slot doesn't 404 on hard nav. |
| 3. Nested catch-all | `@sidebar/docs/[...slug]/page.tsx` | GSP filtered to entries under `/docs/`, prefix stripped — no fake URLs. |

Every marker's `generateStaticParams` is just:

```tsx
import { staticParamsFromConfig } from 'next-parallel-routes/macro'
export const generateStaticParams = staticParamsFromConfig()
```

The plugin replaces the placeholder body at build time and dedupes siblings
sharing the same `[...slug]` mirror key into a single GSP call.

## Run

From the **repo root** (so the workspace links the local package):

```bash
pnpm install
pnpm --filter next-parallel-routes-example-basic build   # static export to ./out
```

The example resolves `next-parallel-routes` to `packages/next-parallel-routes`
via the `workspace:*` link, so it always builds against the local source — no
publish step required.
