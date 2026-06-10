// Group 3 — nested catch-all (lives under a sub-path `docs/`).
// The plugin filters `paths` to entries under `/docs/` and strips that prefix
// from each slug, so this slot only renders `/docs/getting-started/` and
// `/docs/api/` — never fake URLs like `/docs/login/`.
import { staticParamsFromConfig } from 'next-parallel-routes/macro'

export const dynamicParams = false
export const generateStaticParams = staticParamsFromConfig()

export default async function DocsSidebar({
  params,
}: {
  params: Promise<{ slug: string[] }>
}) {
  const { slug } = await params
  return <nav>Docs section: /docs/{slug.join('/')}/</nav>
}
