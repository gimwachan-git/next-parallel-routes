import type { NextConfig } from 'next'
import { withParallelRoutes, type Path } from 'next-parallel-routes'

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
}

// Single source of truth for every statically-exported route. Must agree
// exactly with the `page.tsx` files on disk — the plugin hard-errors on drift.
const paths = [
  '/account/',
  '/account/info/',
  '/docs/getting-started/',
  '/docs/api/',
] as const satisfies readonly Path[]

export default withParallelRoutes(nextConfig, {
  paths,

  // ── autoShimSlots (optional) ───────────────────────────────────────────
  // List Group 2 (fallback-shim) slot names here to have the plugin
  // auto-generate their `[...slug]/page.tsx` from the sibling `default.tsx`,
  // so you only maintain `default.tsx`. This example hand-writes
  // `@sidebar/[...slug]/page.tsx` instead — uncomment to switch, then delete
  // the hand-written file:
  //
  //   autoShimSlots: ['@sidebar'],
  //
  // The generated file gets an `// AUTO-GENERATED` header. A `[...slug]/page.tsx`
  // WITHOUT that header (Group 1 / Group 3 routes) is never overwritten.
  // See examples/auto-shim for a runnable demo of this.

  // ── transientShim (optional) ───────────────────────────────────────────
  // With `autoShimSlots`, set this to delete the generated files on process
  // exit and have the plugin write/maintain an `app/.gitignore` block so they
  // never appear in git:
  //
  //   transientShim: true,

  // ── generateRouteTypes (optional, opt-in) ──────────────────────────────
  // Emit a strict `Route<T>` union (paths + externalRoutes only, no catch-all
  // branch) so `<Link href="/typo" />` fails to compile — stricter than
  // next 16's `typedRoutes: true`. Mutually exclusive with
  // `nextConfig.typedRoutes: true`. `externalRoutes` whitelists valid routes
  // this app links to but does not SSG itself (e.g. other apps in a monorepo):
  //
  //   generateRouteTypes: true,
  //   externalRoutes: ['/login/'],
})
