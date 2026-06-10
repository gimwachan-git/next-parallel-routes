/**
 * Returns a marker function to be used as the value of `generateStaticParams`.
 * At build time, the plugin (loaded via `next.config.ts` →
 * `withParallelRoutes`) recognizes this marker and replaces it with the
 * actual params derived from `nextConfig`-level `paths` (one
 * `{ slug: [...] }` per path).
 *
 * Use this in any parallel-slot catch-all page (`@xxx/[...slug]/page.tsx`)
 * whose params set is the canonical "all known paths". For dictionary-driven
 * mirror slots (e.g. `@metadata`, `@title`, `@breadcrumbs`) you also keep
 * the page's render logic; for pure fallback shims, prefer the `shimSlots`
 * option which auto-generates the page entirely.
 *
 * Imported from `/macro` (and not the package root) so user-side bundles
 * never pull in `index.cjs`'s build-time-only dependencies (`fs`, `path`,
 * `Module._compile`).
 *
 * @example Group 1 (mirror — page.tsx has render logic):
 * ```tsx
 * // app/@title/[...slug]/page.tsx
 * import { staticParamsFromConfig } from 'next-parallel-routes/macro'
 *
 * export const dynamicParams = false
 * export const generateStaticParams = staticParamsFromConfig()
 *
 * export default async function TitlePage({ params }) { ... }
 * ```
 */
export function staticParamsFromConfig(): () => never
