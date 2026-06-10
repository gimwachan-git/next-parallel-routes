// Group 1 — dictionary-driven mirror.
// The plugin injects a `generateStaticParams` that returns the FULL `paths`
// set; this component reads `params` and looks the route up in a dictionary.
import { staticParamsFromConfig } from 'next-parallel-routes/macro'
import { PATH_LABELS } from '@/lib/path-labels'

export const dynamicParams = false
export const generateStaticParams = staticParamsFromConfig()

export default async function Breadcrumbs({
  params,
}: {
  params: Promise<{ slug: string[] }>
}) {
  const { slug } = await params
  const url = '/' + slug.join('/') + '/'
  return <nav aria-label="breadcrumb">{PATH_LABELS[url] ?? url}</nav>
}
