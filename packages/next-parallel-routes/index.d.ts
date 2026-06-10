import type { NextConfig } from 'next'

/**
 * A canonical app path. Must have a **leading slash** (e.g. `'/parallel-route-a/child'`
 * or `'/parallel-route-a/child/'`). TypeScript will reject typos like `'parallel-route-a/child'`
 * (missing leading slash) at the call-site.
 *
 * Whether a **trailing slash** is required depends on your
 * `nextConfig.trailingSlash`:
 *
 *   - `trailingSlash: true`        → use `'/parallel-route-a/child/'`
 *   - `trailingSlash: false` (default) → use `'/parallel-route-a/child'`
 *
 * This is **not** enforced in the type (which would need conditional types
 * keyed on `nextConfig.trailingSlash` and is impractical at the call-site).
 * It is enforced at runtime — `withParallelRoutes` reads
 * `nextConfig.trailingSlash` and rejects paths that don't agree with it.
 *
 * Dynamic segments (`[slug]`, `[...slug]`) and route groups (`(group)`) are
 * filesystem-side only — they should never appear in a registry path string.
 * That rule is also enforced at runtime, not in the type.
 */
export type Path = `/${string}`

export interface ParallelRoutesOptions {
  /**
   * Canonical list of trailing-slash routes the app expects to render
   * statically. Build aborts with a hard error if the app's filesystem
   * routes and this list disagree (missing entries or orphans).
   *
   * Typically: `Object.keys(YOUR_PATH_LABELS_SSOT)`.
   *
   * @example Inline (no external SSOT):
   * ```ts
   * export default withParallelRoutes(nextConfig, {
   *   paths: ['/parallel-route-a/', '/parallel-route-a/child/', '/parallel-route-b/'],
   * })
   * ```
   *
   * @example From an external SSOT object (e.g. path-labels):
   * ```ts
   * import { PATH_LABELS } from '@/lib/const/path-labels'
   *
   * export default withParallelRoutes(nextConfig, {
   *   paths: Object.keys(PATH_LABELS) as Path[],
   * })
   * ```
   */
  paths: readonly Path[]

  /**
   * App-router directory to scan for actual filesystem routes.
   *
   * @default `path.join(process.cwd(), 'app')`
   */
  appDir?: string

  /**
   * If `true`, generated `[...slug]/page.tsx` shims are removed from disk on
   * process exit (`exit` / `SIGINT` / `SIGTERM`), so the source tree only
   * carries these files **while a build/dev process is running**.
   *
   * As a second line of defence against abnormal termination (`kill -9`,
   * SIGSEGV), the plugin also writes an `<appDir>/.gitignore` block listing
   * every generated path explicitly, so any residue stays invisible to
   * `git status` and PR diffs.
   *
   * Cleanup runs only in the main process — `next build` worker children
   * never re-evaluate `next.config.ts`, so they do not register or trigger
   * cleanup themselves.
   *
   * Note: files **must physically exist while next is scanning `appDir`** —
   * Next.js (and Turbopack) read app routes from the real filesystem. This
   * option does not switch to an in-memory virtual fs; it only narrows the
   * lifetime of the on-disk files to `[plugin eval, process exit]`.
   *
   * @default false
   */
  transientShim?: boolean

  /**
   * Slot names (with leading `@`) for which the plugin auto-generates
   * a sibling `[...slug]/page.tsx` shim from `default.tsx`.
   *
   * For each `<appDir>/.../@<slot>/default.tsx`, the plugin writes
   * `[...slug]/page.tsx` next to it with content that mirrors the slot
   * for every registered `paths` entry. Files carry an `AUTO-GENERATED`
   * header; idempotent (skips when content already matches).
   *
   * Template branches on whether `default.tsx` has any top-level `import`:
   * - No imports: inlines a `return null` body (avoids a Linux + node 24 +
   *   `isolatedModules` tsc edge case where importing a zero-import sibling
   *   `.tsx` reports `TS2307`).
   * - Has imports: re-exports via `import Default from '../default'`.
   *
   * @example
   * ```ts
   * withParallelRoutes(nextConfig, {
   *   paths,
   *   autoShimSlots: ['@header', '@modal', '@aside'],
   * })
   * ```
   *
   * @default undefined (no auto-gen)
   */
  autoShimSlots?: readonly string[]

  /**
   * If `true`, the plugin writes
   * `<appDir>/../.next/types/parallel-routes.d.ts` augmenting `next`,
   * `next/link`, and `next/navigation` so that `Route<T>` is a strict union
   * of `paths` only. This catches typo routes like `<Link href="/aboot" />`
   * that next.js's own `typedRoutes: true` cannot catch when a root
   * `[...slug]` catch-all is present (the catch-all branch widens the
   * union to any `/something` literal).
   *
   * **Mutually exclusive with `nextConfig.typedRoutes: true`** — plugin will
   * throw if both are enabled. The plugin replaces, not supplements, next's
   * own typedRoutes.
   *
   * Opt-in only. Migrating an existing codebase typically surfaces a large
   * number of `as Route` casts for dynamic URLs / cross-app navigation /
   * router method calls. Audit migration cost before enabling.
   *
   * @default false
   */
  generateRouteTypes?: boolean

  /**
   * Whitelist of route literals that are **valid but not SSG'd by this app**
   * (typically routes served by other apps in a monorepo). Only used when
   * `generateRouteTypes: true`.
   *
   * Without this option, calls like `router.push('/external-route-a')` in shared
   * code that lives in `packages/core` would fail type-check because the
   * plugin only knows about the current app's `paths`. List those known
   * cross-app routes here to keep type-safety without `as Route` casts.
   *
   * Both `/foo` and `/foo/` forms type-check (the plugin emits both in the
   * union to match `trailingSlash` users' habits).
   */
  externalRoutes?: readonly Path[]

  /**
   * Set to `false` to silence the `[next-parallel-routes] …` log lines that
   * report patch application and registry-check success.
   *
   * @default true
   */
  verbose?: boolean
}

/**
 * Re-exported from `./macro` for convenience. Prefer importing from
 * `next-parallel-routes/macro` in user `page.tsx` files — this
 * package root entry drags in `fs`/`path`/`Module` for the `withParallelRoutes`
 * build-time hooks, which Turbopack will try (and fail) to bundle into a
 * server-component graph.
 */
export { staticParamsFromConfig } from './macro'

/**
 * Wraps a {@link NextConfig} with build-time guarantees for parallel-route
 * catch-all SSG under `output: 'export'`:
 *
 *  1. **Route registry health check** — fails the build (hard error) if the
 *     filesystem app routes and `options.paths` disagree (missing entries or
 *     orphans). Replaces a standalone check-route-labels-style script.
 *
 *  2. **`staticParamsFromConfig()` marker resolution** — every parallel-slot
 *     `[...slug]/page.tsx` that uses the macro helper gets its placeholder
 *     `generateStaticParams` replaced at runtime with one returning paths
 *     derived from `options.paths`.
 *
 *  3. **Route-aware filter for nested catch-alls** — for slots whose
 *     catch-all sits under a sub-path (e.g. `@sidebar/docs/[...slug]`),
 *     the resolver auto-filters `paths` to entries matching that prefix, so
 *     the build does not produce fake URLs like `/docs/login/`.
 *
 *  4. **Parallel-slot GSP dedupe by mirror key** — patches next.js's
 *     `generateRouteStaticParams` to collapse same-mirror-key siblings into
 *     one GSP call, preventing the K^N cartesian-product OOM.
 *
 * Usage:
 * ```ts
 * // next.config.ts
 * import { withParallelRoutes, type Path } from 'next-parallel-routes'
 *
 * const paths = ['/parallel-route-a/', '/parallel-route-a/child/'] as const satisfies readonly Path[]
 *
 * export default withParallelRoutes(nextConfig, { paths })
 * ```
 *
 * ```tsx
 * // app/@<slot>/[...slug]/page.tsx
 * import { staticParamsFromConfig } from 'next-parallel-routes/macro'
 *
 * export const dynamicParams = false
 * export const generateStaticParams = staticParamsFromConfig()
 * export default async function Slot(...) { ... }
 * ```
 */
export function withParallelRoutes<T extends NextConfig>(
  nextConfig: T,
  options: ParallelRoutesOptions,
): T

/**
 * Returns the absolute path to `preload.cjs`. Use this only if you'd rather
 * wire `--require=…` into your build script manually.
 */
export function getPreloadPath(): string

export default withParallelRoutes
