// Group 2 — fallback shim.
// The slot needs a catch-all sibling so hard navigation doesn't 404, but its
// content is identical to `default.tsx`. Re-export it. (Prefer this form over
// `export { default } from '../default'` — see the package README.)
import { staticParamsFromConfig } from 'next-parallel-routes/macro'
import Default from '../default'

export const dynamicParams = false
export const generateStaticParams = staticParamsFromConfig()
export default Default
