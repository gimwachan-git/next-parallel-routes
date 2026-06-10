# `next-parallel-routes`

A `next.config` wrapper that makes **parallel-route catch-all SSG actually
work** under `output: 'export'`:

- **`next.config.ts` is the single source of truth** for static paths.
- **Each parallel-slot `[...slug]/page.tsx` is a 4-line marker file** — the
  plugin injects the actual `generateStaticParams` body at build time.
- **No fake URLs.** Nested catch-alls (`@sidebar/docs/[...slug]`) are
  auto-filtered to entries under their URL prefix.
- **No OOM.** Parallel siblings sharing the same `[...slug]` placeholder are
  deduped to one GSP call instead of K^N.
- **Hard error on registry drift.** If a `page.tsx` route exists in the app
  but is missing from `paths` (or vice versa), the build fails immediately
  with a clear list of offenders.
- **Strict typed routes (opt-in).** Set `generateRouteTypes: true` and the
  plugin emits a stricter `Route<T>` union than Next 16's built-in
  `typedRoutes: true` — the catch-all branch (which lets typo routes like
  `<Link href="/aboot" />` slip through any app that uses parallel-slot
  `[...slug]` mirrors) is dropped. Cross-app navigation is whitelisted
  through `externalRoutes`.

The implementation is project-agnostic and framework-internal-patch based —
it works in any Next.js 16 app, monorepo or single-package alike.

> Background: `output: 'export'` is incompatible with native intercepting
> routes (Next.js issues [#52880](https://github.com/vercel/next.js/issues/52880),
> [#56253](https://github.com/vercel/next.js/issues/56253), open for 4+ years).
> The standard workaround — parallel-slot `[...slug]/page.tsx` files
> mirroring every URL — collapses without this plugin: see
> [§ Why this plugin exists](#why-this-plugin-exists).

## Quick start

1. Install the package:

   ```bash
   npm install next-parallel-routes
   # or: pnpm add next-parallel-routes
   # or: yarn add next-parallel-routes
   ```

2. Declare every static route in `next.config.ts`:

   ```ts
   // apps/<app>/next.config.ts
   import type { NextConfig } from 'next'
   import { withParallelRoutes, type Path } from 'next-parallel-routes'

   const nextConfig: NextConfig = {
     output: 'export',
     trailingSlash: true,
     // …
   }

   const paths = [
     '/parallel-route-a/',
     '/parallel-route-a/child/',
     '/parallel-route-b/',
     // …every static URL you want SSG'd…
   ] as const satisfies readonly Path[]

   export default withParallelRoutes(nextConfig, { paths })
   ```

3. In every parallel-slot `[...slug]/page.tsx`, use the macro helper:

   ```tsx
   // app/@metadata/[...slug]/page.tsx (Group 1: dictionary-driven mirror)
   import { staticParamsFromConfig } from 'next-parallel-routes/macro'

   export const dynamicParams = false
   export const generateStaticParams = staticParamsFromConfig()

   export const generateMetadata = ({ params }: { params: Promise<{ slug: string[] }> }) => {
     // …look up per-path metadata from your dictionary…
   }
   export default function Metadata() { return null }
   ```

   ```tsx
   // app/(app)/@header/[...slug]/page.tsx (Group 2: fallback shim)
   import { staticParamsFromConfig } from 'next-parallel-routes/macro'
   import Default from '../default'

   export const dynamicParams = false
   export const generateStaticParams = staticParamsFromConfig()
   export default Default
   ```

   > Note: prefer `import Default from '../default'; export default Default` over
   > `export { default } from '../default'` — the latter trips a spurious
   > `TS2307: Cannot find module` under some `tsc` + `next 16` typed-routes
   > augmentation combinations. Both are runtime-equivalent.

   ```tsx
   // app/(sub)/@sidebar/docs/[...slug]/page.tsx (Group 3: nested catch-all)
   import { staticParamsFromConfig } from 'next-parallel-routes/macro'
   import { DocsPage } from '@/components/docs'

   export const dynamicParams = false
   export const generateStaticParams = staticParamsFromConfig()
   export default DocsPage
   ```

   The plugin handles the rest:

   - Group 1 / 2 (catch-all directly under the slot root) → expands to every
     path in `options.paths`.
   - Group 3 (catch-all under a sub-path like `docs/`) → filtered to
     entries whose URL starts with that sub-path.

## API

### `withParallelRoutes(nextConfig, options)`

```ts
type Path = `/${string}`

interface ParallelRoutesOptions {
  /**
   * Canonical list of trailing-slash routes the app expects to render
   * statically. Build aborts (hard error) if filesystem routes and this
   * list disagree.
   */
  paths: readonly Path[]

  /**
   * Slots whose `[...slug]/page.tsx` should be auto-generated from a
   * sibling `default.tsx` (Group 2 fallback shims). The generator picks
   * between two templates based on whether `default.tsx` has top-level
   * imports — see `index.d.ts` for the full rationale.
   */
  autoShimSlots?: readonly string[]

  /**
   * If `true`, the auto-generated `[...slug]/page.tsx` shims are removed
   * from disk when the build/dev process exits. The source tree only
   * carries these files **while the process is alive**. See § Transient
   * shim mode below.
   *
   * @default false
   */
  transientShim?: boolean

  /**
   * If `true`, emit a strict `Route<T>` augmentation at
   * `<appDir>/../.next/types/parallel-routes.d.ts`. The union contains
   * `paths` + `externalRoutes` literals only — no catch-all branch — so
   * typo routes like `<Link href="/aboot" />` fail to compile.
   *
   * Mutually exclusive with `nextConfig.typedRoutes: true`.
   *
   * @default false (opt-in; migration typically requires `as Route` casts
   *   at every dynamic URL site)
   */
  generateRouteTypes?: boolean

  /**
   * Whitelist of route literals that are **valid but not SSG'd by this
   * app** — typically routes served by other apps in a monorepo. Only
   * consulted when `generateRouteTypes: true`. Without this list, shared
   * code in `packages/core` that pushes to `/external-route-a` would fail
   * type-check because the plugin only knows about the current app's
   * `paths`.
   *
   * Both `/foo` and `/foo/` forms type-check.
   */
  externalRoutes?: readonly Path[]

  /** Defaults to `path.join(process.cwd(), 'app')`. */
  appDir?: string

  /** Defaults to `true`. Set `false` to silence `[next-parallel-routes] …` logs. */
  verbose?: boolean
}

function withParallelRoutes<T extends NextConfig>(
  nextConfig: T,
  options: ParallelRoutesOptions,
): T
```

`paths` entries must agree with `nextConfig.trailingSlash`:

- `trailingSlash: true` → use `'/parallel-route-a/child/'`
- `trailingSlash: false` (default) → use `'/parallel-route-a/child'`

This is enforced at runtime.

### `staticParamsFromConfig()` (from `./macro`)

```ts
import { staticParamsFromConfig } from 'next-parallel-routes/macro'

export const generateStaticParams = staticParamsFromConfig()
```

Returns a placeholder GSP function whose body is replaced at build time. Must
be imported from the `./macro` subpath — the root entry (`/index.cjs`) drags
in `fs` / `path` / `Module._compile` for the `withParallelRoutes` hooks,
which Turbopack will try (and fail) to bundle into a server-component graph.

### `getPreloadPath()`

Returns the absolute path to `preload.cjs`. Use if you want to wire
`--require=…` into your build script manually rather than calling
`withParallelRoutes(…)` from `next.config.ts`.

## Strict typed routes (`generateRouteTypes`)

Next 16's built-in `typedRoutes: true` is **insufficient for any app that
uses a parallel-slot `[...slug]` mirror**. Next generates a `DynamicRoutes`
branch in `RouteImpl<T>` that matches any `/something` literal, so `<Link
href="/aboot" />` (and any other typo) sneaks through unchecked.

Enable `generateRouteTypes: true` and the plugin emits an alternative
`.next/types/parallel-routes.d.ts` that augments `next`, `next/link`, and
`next/navigation` with a **catch-all-free** `Route<T>` union:

```ts
// next.config.ts
import { withParallelRoutes, type Path } from 'next-parallel-routes'

const paths = [
  '/', '/parallel-route-a/', '/parallel-route-a/child/', // …
] as const satisfies readonly Path[]

const externalRoutes = [
  // Other apps' routes the current app navigates to but does not SSG itself.
  '/external-route-a/', '/external-route-b/', '/external-route-c/',
] as const satisfies readonly Path[]

export default withParallelRoutes(nextConfig, {
  paths,
  externalRoutes,
  generateRouteTypes: true,
})
```

The generated union has shape:

```ts
type RouteImpl<_T> =
  | SsgRoute       // paths + auto-detected root '/'
  | ExternalRoute  // externalRoutes whitelist
  | SearchOrHash   // ?... | #...
  | WithProtocol   // ${string}:${string}
  | `${AppRoute}${SearchOrHash}`
// NO catch-all branch — `<Link href="/aboot" />` is rejected with a
// "Did you mean '/parallel-route-a'?" hint.
```

Both trailing-slash forms (`/foo` and `/foo/`) are emitted so user code
written either way type-checks.

### When to enable

- ✅ App already keeps `paths` as the SSG SSOT (this plugin's central tenet).
- ✅ You want compile-time typo protection that Next 16's catch-all-leaking
  typedRoutes cannot provide.
- ⚠️ Migrating an existing codebase typically surfaces `as Route` casts for
  dynamic URLs (`router.push(url.toString() as Route)`,
  `<Link href={item.href as Route}>`). Audit the cost first.
- ❌ Do not combine with `nextConfig.typedRoutes: true` — the plugin throws
  at config eval (duplicate module augmentation would clash).

## How it works

`withParallelRoutes(nextConfig, options)` does five things at
`next.config.ts` evaluation time:

1. **(Optional) Auto-generates Group 2 shim files.**
   For every slot listed in `autoShimSlots`, writes
   `<slot>/[...slug]/page.tsx` based on the sibling `default.tsx`.

2. **Validates the route registry.**
   Walks `appDir`, collects every `page.tsx` route, and asserts it equals
   `options.paths`. Mismatches abort the build with explicit
   missing-/orphan-listings.

3. **(Optional) Emits strict `Route` type augmentation.**
   When `generateRouteTypes: true`, writes
   `<appDir>/../.next/types/parallel-routes.d.ts` augmenting `next`,
   `next/link`, `next/navigation` so `Route<T>` is
   `paths ∪ externalRoutes` literal union (with no catch-all leak).

4. **Stashes `paths` in `NEXT_PARALLEL_ROUTES_PATHS_JSON` + prepends
   `--require=<preload.cjs>` to `NODE_OPTIONS`.**
   So the preload script (which runs in every worker via `NODE_OPTIONS`)
   can re-read the same data after the process boundary, and installs the
   `Module.prototype._compile` hook that fires once `next` requires
   `next/dist/build/static-paths/app.js`.

5. **Patches `generateRouteStaticParams` in that module.**
   The patch is a single prepended line:

   ```js
   async function generateRouteStaticParams(segments, store, isRoutePPREnabled) {
     segments = __nbpDedupeParallelSegments(segments) // ← inserted
     // …original body…
   }
   ```

   `__nbpDedupeParallelSegments` then runs two steps in order:

   **a. Marker resolution + route-aware filter.** Walks `segments` looking
   for functions carrying the
   `Symbol.for('next-parallel-routes.static-params-from-config')` marker.
   For each match, computes the route's URL prefix from `segments[i].name`
   (skipping route groups `(xxx)`, slots `@xxx`, dynamic `[xxx]`, and
   internal markers `__DEFAULT__` / `__PAGE__`), filters `paths` to entries
   starting with that prefix, and replaces the segment's
   `generateStaticParams` with a real function returning the filtered array.

   - `/[...slug]` → prefix `[]`, returns all paths.
   - `/docs/[...slug]` → prefix `['docs']`, returns only the
     `/docs/<x>/` subset with the prefix stripped from each slug.

   **b. Dedupe by mirror key.** Groups segments by the path portion after
   their `/@slot/` marker (the *mirror key*). Within a group, keeps one GSP
   and strips the rest from `generateStaticParams` (other metadata such as
   `paramName`, `paramType`, `filePath`, `config` is preserved).

   - `@title/[...slug]/page.tsx` and `@breadcrumbs/[...slug]/page.tsx` share
     mirror key `[...slug]/page.tsx` → dedupe (collapses N siblings to 1
     GSP call).
   - `@sidebar/docs/[...slug]/page.tsx` has mirror key
     `docs/[...slug]/page.tsx` → separate group, own GSP preserved.

## Auto-generating Group 2 shims (`autoShimSlots`)

Group 2 slots (fallback shims) are pure boilerplate: a `[...slug]/page.tsx`
that exists only so the slot doesn't 404 on hard navigation, with content
identical to the slot's `default.tsx`. `autoShimSlots` writes those files for
you so you only maintain `default.tsx`.

**Before** — you hand-write the shim for every slot:

```
app/@sidebar/
├─ default.tsx
└─ [...slug]/page.tsx     ← boilerplate you write & keep in sync by hand
```

**After** — list the slot in `autoShimSlots` and write only `default.tsx`:

```ts
// next.config.ts
export default withParallelRoutes(nextConfig, {
  paths,
  autoShimSlots: ['@sidebar', '@breadcrumbs'],
})
```

```
app/@sidebar/
└─ default.tsx           ← the only file you write
```

At `next.config` eval the plugin scans each `@<slot>/default.tsx` listed and
generates the sibling `[...slug]/page.tsx`. The template depends on whether
`default.tsx` has any **top-level `import`**:

| `default.tsx` | Generated `[...slug]/page.tsx` |
|---|---|
| **has imports** | re-export shim — `import Default from '../default'; export default Default` |
| **no imports** | inline shim — `export default function <Slot>CatchAll() { return null }` |

> The no-import branch deliberately avoids `import '../default'`: a Linux +
> Node 24 + `isolatedModules` `tsc` edge case reports a spurious `TS2307` when
> importing a zero-import sibling `.tsx`.

Example — `@sidebar/default.tsx` imports a component, so the plugin emits:

```tsx
// app/@sidebar/[...slug]/page.tsx
// AUTO-GENERATED by next-parallel-routes — do not edit
// Source: @sidebar/default.tsx
// To customise, edit default.tsx (and/or add a slot-specific page.tsx)
import { staticParamsFromConfig } from 'next-parallel-routes/macro'
import Default from '../default'

export const dynamicParams = false
export const generateStaticParams = staticParamsFromConfig()
export default Default
```

Behaviour:

- **Idempotent.** The file is rewritten only when it differs from what
  `default.tsx` implies — clean builds produce no diff.
- **Never clobbers your code.** A `[...slug]/page.tsx` that lacks the
  `AUTO-GENERATED` header is treated as a hand-written Group 1 / Group 3 route
  and left untouched. So the same slot name can be auto-shimmed in one part of
  the tree and hand-written elsewhere.
- **Requires `default.tsx`.** Slots in `autoShimSlots` with no `default.tsx`
  are skipped.

By default the generated files stay on disk (commit them, or `.gitignore`
them as derived artifacts). To make them vanish between builds, see
`transientShim` below.

See [`examples/auto-shim`](../../examples/auto-shim) for a runnable version.

## Transient shim mode (`transientShim`)

By default, `autoShimSlots` writes `[...slug]/page.tsx` files into your
source tree and leaves them there — visible in the editor, committed to
git, regenerated whenever you (or the plugin) change `default.tsx`.

`transientShim: true` switches to a **shim-on-demand** model:

```ts
export default withParallelRoutes(nextConfig, {
  paths,
  autoShimSlots: ['@title', '@breadcrumbs', '@aside', '@header'],
  transientShim: true,
})
```

- **At `next.config` eval** (build start, dev start) the plugin generates
  the shim files exactly as before. They must physically exist on disk —
  Next.js (Turbopack and webpack) reads app routes from the real
  filesystem.
- **At process exit** (`exit` / `SIGINT` / `SIGTERM`) the plugin
  `unlinkSync`s every generated file and removes any now-empty
  `[...slug]/` directory. After `next build` returns, the source tree is
  visually clean.
- **As a second line of defence**, the plugin writes (and keeps in sync)
  an `<appDir>/.gitignore` block listing every generated path explicitly,
  so if the process is killed with `SIGKILL` / `kill -9` / SIGSEGV before
  cleanup fires, the residue still won't show up in `git status` or PR
  diffs. The next build run will regenerate from scratch.

Cleanup runs only in the main process — `next build`'s jest-worker
children inherit env vars but never re-evaluate `next.config.ts`, so
they don't register cleanup handlers and can't prematurely delete the
shims that the main process still needs.

Trade-offs:

- ✅ source tree visually clean between builds
- ✅ git diffs never mention `[...slug]/page.tsx`
- ✅ no IDE-level "what's this AUTO-GENERATED file" friction
- ⚠️ files do exist while a build/dev process is running — if you open
  the editor mid-`pnpm dev` you'll see them
- ⚠️ the per-app `<appDir>/.gitignore` is owned by the plugin (between
  its sentinel markers); manual entries outside the sentinel block are
  preserved across runs

If you'd rather check the shims into git as canonical source (PR 2176
default behaviour), leave `transientShim` unset and remove the relevant
lines from `.gitignore`.

## Group classification

| Group | Pattern | Example | Plugin behaviour |
|---|---|---|---|
| 1. Dictionary-driven mirror | `/@<slot>/[...slug]/page.tsx` (uses `params` in render) | `@metadata`, `@title`, `@breadcrumbs` | Returns the full `paths` set; user `page.tsx` body reads `params` and looks up a dictionary. |
| 2. Fallback shim | `/@<slot>/[...slug]/page.tsx` (re-exports `default` from `../default.tsx`) | `@header`, `@modal`, `@aside` | Returns the full `paths` set; content identical to default — exists only because Next.js parallel routes hard-nav to 404 if a slot has no catch-all sibling. |
| 3. Nested catch-all | `/@<slot>/<sub-path>/[...slug]/page.tsx` | `@sidebar/docs/[...slug]/page.tsx` | Filters `paths` to entries under `<sub-path>/` and strips that prefix from each slug. Prevents fake URLs. |

## Measured impact (production app, next 16.1.0, 7 catch-all slots, 35 paths)

| Metric | Before plugin | After plugin |
|---|---|---|
| `pnpm build` wall time | 80 – 90 s (when build completes) | **~36 s** |
| `generateRouteStaticParams` peak heap | ~4 GB | **< 100 MB** |
| User `generateStaticParams` invocations | 35^N (N=5 mirror slots) ≈ 5.25 × 10⁷ | **35** |
| SSG page count (root mirror) | 35 | 35 |
| SSG page count (`/docs/[...slug]`) | 35 (incl. fake `/docs/auth/`, `/docs/maintenance/`, etc.) | **6** (real sub-paths only) |
| CI worker `--max-old-space-size` | needed (≥ 6 GB) | not needed |
| Boilerplate per slot | ~10–20 lines GSP + import dictionary | 4 lines (marker file) |

## Upgrading next

The patch matches a single source needle:

```js
async function generateRouteStaticParams(segments, store, isRoutePPREnabled) {
```

If a future next release changes this signature, the hook logs

```
[next-parallel-routes] could not locate generateRouteStaticParams in <path> — next internal layout changed; patch skipped.
```

and the build falls through to the (slow, OOM-prone, fake-URL-prone) vanilla
behaviour. Verified against **next 16.1.0** — re-verify after every
`next` upgrade by reading `node_modules/next/dist/build/static-paths/app.js`.

## Why this plugin exists

In a plain Next.js App Router app under `output: 'export'`:

- **Intercepting routes** (`@modal/(.)photos/[id]`) don't work — they need
  client navigation context that static exports don't have
  ([#52880](https://github.com/vercel/next.js/issues/52880),
  [#56253](https://github.com/vercel/next.js/issues/56253)).
- **The standard workaround** is to use parallel-route catch-alls:
  `app/@modal/[...slug]/page.tsx` mirrors every URL, alongside specific
  pages like `app/@modal/photos/[id]/page.tsx`. This makes the slot register
  for every URL the app statically generates, so hard navigation doesn't
  404.

But that workaround interacts badly with Next.js's
`generateRouteStaticParams`:

1. Each parallel-slot `[...slug]/page.tsx` that exports
   `generateStaticParams` is treated as an **independent route segment**.
2. Their results are **cartesian-multiplied**. For N slots × K paths,
   user code is invoked **K^N times**.
3. For nested catch-alls (e.g. `@sidebar/docs/[...slug]`), the same
   K-path GSP is **expanded across every sibling's URL**, generating fake
   URLs like `/docs/auth/` that should never exist.

This plugin fixes both behaviours at the runtime patch level — without
forking next.js, modifying its source tree, or requiring a `pnpm patch`
artefact.

## Removing the plugin

If a future next release fixes the upstream issues:

```ts
- export default withParallelRoutes(nextConfig, { paths })
+ export default nextConfig
```

…and remove the dependency. The patch is fully contained inside this
package; user `page.tsx` files still need their imports updated from
`next-parallel-routes/macro` to native `export async function
generateStaticParams()` (or whatever the upstream replacement is).
